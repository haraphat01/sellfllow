-- =============================================================================
-- Row Level Security.
--
-- Principles
--  * RLS is enabled on EVERY public table. A table with no policy for a role is
--    fully closed to that role.
--  * Dashboard users (role `authenticated`) only ever see rows of businesses
--    they are an active member of, further narrowed by permission.
--  * Tables written exclusively by trusted server code (webhook events,
--    payments, AI audit, usage, credentials) have NO write policies: only the
--    service role (which bypasses RLS) can write them.
--  * `anon` gets nothing, except reading active public plans for pricing page.
-- =============================================================================

-- Enable RLS everywhere.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end;
$$;

-- Generic tenant policy generator.
--   read_perm  : null => any active member may read
--   write_perm : null => no insert/update/delete for authenticated
create or replace function private.apply_tenant_policies(
  p_table text,
  p_read_perm text,
  p_write_perm text,
  p_allow_delete boolean default true
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  read_expr text := case
    when p_read_perm is null then '(select private.is_member(business_id))'
    else format('(select private.has_perm(business_id, %L))', p_read_perm)
  end;
  write_expr text := format('(select private.has_perm(business_id, %L))', p_write_perm);
begin
  execute format('create policy %I on public.%I for select to authenticated using (%s)',
                 p_table || '_select', p_table, read_expr);
  if p_write_perm is not null then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
                   p_table || '_insert', p_table, write_expr);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                   p_table || '_update', p_table, write_expr, write_expr);
    if p_allow_delete then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)',
                     p_table || '_delete', p_table, write_expr);
    end if;
  end if;
end;
$$;

--                                   table                   read perm              write perm            delete
select private.apply_tenant_policies('products',             null,                  'products.manage');
select private.apply_tenant_policies('product_variants',     null,                  'products.manage');
select private.apply_tenant_policies('product_images',       null,                  'products.manage');
select private.apply_tenant_policies('inventory_movements',  'products.manage',     null);
select private.apply_tenant_policies('whatsapp_accounts',    null,                  null);
select private.apply_tenant_policies('customers',            'customers.view',      'customers.manage',  false);
select private.apply_tenant_policies('customer_tags',        'customers.view',      'customers.manage');
select private.apply_tenant_policies('conversations',        'conversations.view',  null);
select private.apply_tenant_policies('messages',             'conversations.view',  null);
select private.apply_tenant_policies('conversation_events',  'conversations.view',  null);
select private.apply_tenant_policies('orders',               'orders.view',         'orders.manage',     false);
select private.apply_tenant_policies('order_items',          'orders.view',         null);
select private.apply_tenant_policies('payments',             'orders.view',         null);
select private.apply_tenant_policies('ai_agents',            null,                  'settings.manage',   false);
select private.apply_tenant_policies('ai_settings',          null,                  'settings.manage',   false);
select private.apply_tenant_policies('ai_actions',           'conversations.view',  null);
select private.apply_tenant_policies('ai_usage',             'analytics.view',      null);
select private.apply_tenant_policies('follow_ups',           'campaigns.manage',    null);
select private.apply_tenant_policies('campaigns',            'campaigns.manage',    'campaigns.manage');
select private.apply_tenant_policies('campaign_recipients',  'campaigns.manage',    null);
select private.apply_tenant_policies('subscriptions',        null,                  null);
select private.apply_tenant_policies('usage_records',        null,                  null);
select private.apply_tenant_policies('billing_events',       'billing.manage',      null);
select private.apply_tenant_policies('audit_logs',           'settings.manage',     null);
select private.apply_tenant_policies('business_invitations', 'staff.manage',        null);

-- Conversation state changes (pause/resume AI, assign) go through server
-- actions that check `conversations.reply` and write via the user's session.
create policy conversations_update on public.conversations for update to authenticated
  using ((select private.has_perm(business_id, 'conversations.reply')))
  with check ((select private.has_perm(business_id, 'conversations.reply')));
create policy conversation_events_insert on public.conversation_events for insert to authenticated
  with check (
    (select private.has_perm(business_id, 'conversations.reply'))
    and actor_type = 'user'
    and actor_user_id = (select auth.uid())
  );

-- Notifications: members see business-wide ones and their own.
create policy notifications_select on public.notifications for select to authenticated
  using ((select private.is_member(business_id)) and (user_id is null or user_id = (select auth.uid())));
create policy notifications_update on public.notifications for update to authenticated
  using ((select private.is_member(business_id)) and (user_id is null or user_id = (select auth.uid())))
  with check ((select private.is_member(business_id)) and (user_id is null or user_id = (select auth.uid())));

-- -----------------------------------------------------------------------------
-- Non-standard tables
-- -----------------------------------------------------------------------------

-- profiles: users see/edit themselves, and see teammates' basic profile.
create policy profiles_select_self on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.business_members me
      join public.business_members them on them.business_id = me.business_id
      where me.user_id = (select auth.uid()) and me.status = 'active'
        and them.user_id = profiles.id
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- businesses: members read; settings.manage updates. Creation only via create_business().
create policy businesses_select on public.businesses for select to authenticated
  using ((select private.is_member(id)));
create policy businesses_update on public.businesses for update to authenticated
  using ((select private.has_perm(id, 'settings.manage')))
  with check ((select private.has_perm(id, 'settings.manage')));

-- Suspension is platform-controlled.
create or replace function private.guard_business_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.status is distinct from old.status or new.suspended_reason is distinct from old.suspended_reason
      or new.order_seq is distinct from old.order_seq)
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'business status can only be changed by the platform';
  end if;
  return new;
end;
$$;

create trigger businesses_guard_status before update on public.businesses
  for each row execute function private.guard_business_status();

-- business_members: members see their team. Changes happen through the staff
-- service (server-side, checks staff.manage and protects the owner).
create policy business_members_select on public.business_members for select to authenticated
  using ((select private.is_member(business_id)));

-- Reference data.
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy subscription_plans_select on public.subscription_plans for select to anon, authenticated
  using (is_active and is_public);

-- business_credentials, whatsapp_events, payment_events, platform_settings:
-- intentionally no policies (service role only).

-- -----------------------------------------------------------------------------
-- Realtime for the inbox.
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;

-- -----------------------------------------------------------------------------
-- Column-level hardening: authenticated users cannot rewrite tenant ownership.
-- -----------------------------------------------------------------------------
create or replace function private.forbid_business_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'business_id is immutable';
  end if;
  return new;
end;
$$;

do $$
declare
  t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    join pg_tables p on p.schemaname = c.table_schema and p.tablename = c.table_name
    where c.table_schema = 'public' and c.column_name = 'business_id'
  loop
    execute format(
      'create trigger %I before update of business_id on public.%I for each row execute function private.forbid_business_id_change()',
      t.table_name || '_business_id_immutable', t.table_name
    );
  end loop;
end;
$$;

drop function private.apply_tenant_policies(text, text, text, boolean);
