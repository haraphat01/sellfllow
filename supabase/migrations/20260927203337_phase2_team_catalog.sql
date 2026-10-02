-- =============================================================================
-- Phase 2: team management, invitations, inventory ledger, product import.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Defence in depth: service-role-only tables get no table privileges at all
-- for client roles (RLS already denies them; this removes the grant too).
-- -----------------------------------------------------------------------------
revoke all on public.business_credentials, public.whatsapp_events, public.payment_events, public.platform_settings
  from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Team management
-- -----------------------------------------------------------------------------
create or replace function private.is_owner(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = 'owner'
  );
$$;

revoke execute on function private.is_owner(uuid) from public, anon;
grant execute on function private.is_owner(uuid) to authenticated, service_role;

-- Permission lists may only contain known permission keys.
create or replace function private.validate_permissions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(new.permissions) p
    where p not in (select key from public.permissions)
  ) then
    raise exception 'unknown permission in %', new.permissions using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger business_members_validate_permissions before insert or update of permissions on public.business_members
  for each row execute function private.validate_permissions();
create trigger business_invitations_validate_permissions before insert or update of permissions on public.business_invitations
  for each row execute function private.validate_permissions();

-- Members with staff.manage can change/remove staff. Only the owner can manage
-- admins or grant the admin role. Nobody can modify the owner or themselves.
create policy business_members_update on public.business_members for update to authenticated
  using (
    (select private.has_perm(business_id, 'staff.manage'))
    and role <> 'owner'
    and user_id <> (select auth.uid())
    and (role = 'staff' or (select private.is_owner(business_id)))
  )
  with check (
    (select private.has_perm(business_id, 'staff.manage'))
    and role <> 'owner'
    and user_id <> (select auth.uid())
    and (role = 'staff' or (select private.is_owner(business_id)))
  );

create policy business_members_delete on public.business_members for delete to authenticated
  using (
    (select private.has_perm(business_id, 'staff.manage'))
    and role <> 'owner'
    and user_id <> (select auth.uid())
    and (role = 'staff' or (select private.is_owner(business_id)))
  );

create policy business_invitations_insert on public.business_invitations for insert to authenticated
  with check (
    (select private.has_perm(business_id, 'staff.manage'))
    and (role = 'staff' or (select private.is_owner(business_id)))
    and invited_by = (select auth.uid())
    and accepted_at is null
  );

create policy business_invitations_delete on public.business_invitations for delete to authenticated
  using ((select private.has_perm(business_id, 'staff.manage')) and accepted_at is null);

-- Public lookup of an invitation by its secret token (for the accept page).
-- Knowing the token is the capability; nothing else is revealed.
create or replace function public.get_invitation(p_token text)
returns table (business_name text, role public.member_role, email text, expired boolean, accepted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select b.name, i.role, i.email::text, i.expires_at < now(), i.accepted_at is not null
  from public.business_invitations i
  join public.businesses b on b.id = i.business_id
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

revoke execute on function public.get_invitation(text) from public, anon;
grant execute on function public.get_invitation(text) to authenticated;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.business_invitations%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_inv from public.business_invitations
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
   for update;

  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation already used' using errcode = '22023';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'invitation expired' using errcode = '22023';
  end if;

  select email::text into v_email from public.profiles where id = v_user;
  if lower(v_email) <> lower(v_inv.email::text) then
    raise exception 'invitation was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.business_members (business_id, user_id, role, permissions, status, invited_by)
  values (v_inv.business_id, v_user, v_inv.role, v_inv.permissions, 'active', v_inv.invited_by)
  on conflict (business_id, user_id) do update
    set role = case when public.business_members.role = 'owner' then 'owner'::public.member_role else excluded.role end,
        permissions = excluded.permissions,
        status = 'active';

  update public.business_invitations set accepted_at = now() where id = v_inv.id;

  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_inv.business_id, v_user, 'member.joined', 'business_invitation', v_inv.id, jsonb_build_object('role', v_inv.role));

  return v_inv.business_id;
end;
$$;

revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Inventory ledger: every stock change on products/variants is recorded
-- automatically. Callers may set `sellflow.stock_reason` / `sellflow.stock_order_id`
-- (transaction-local) to label the movement.
-- -----------------------------------------------------------------------------
create or replace function private.log_stock_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta integer;
  v_reason text;
  v_order uuid;
  v_product uuid;
  v_variant uuid;
begin
  v_delta := new.stock_quantity - case when tg_op = 'INSERT' then 0 else old.stock_quantity end;
  if v_delta = 0 then
    return new;
  end if;

  v_reason := coalesce(
    nullif(current_setting('sellflow.stock_reason', true), ''),
    case when tg_op = 'INSERT' then 'restock' else 'manual_adjustment' end
  );
  v_order := nullif(current_setting('sellflow.stock_order_id', true), '')::uuid;

  if tg_table_name = 'products' then
    v_product := new.id;
  else
    v_product := (to_jsonb(new) ->> 'product_id')::uuid;
    v_variant := new.id;
  end if;

  insert into public.inventory_movements (business_id, product_id, variant_id, delta, reason, order_id, actor_user_id)
  values (new.business_id, v_product, v_variant, v_delta, v_reason, v_order, auth.uid());
  return new;
end;
$$;

create trigger products_stock_ledger after insert or update of stock_quantity on public.products
  for each row execute function private.log_stock_change();
create trigger product_variants_stock_ledger after insert or update of stock_quantity on public.product_variants
  for each row execute function private.log_stock_change();

-- -----------------------------------------------------------------------------
-- Bulk product import (CSV). SECURITY INVOKER: runs under the caller's RLS, so
-- it only works for members with products.manage on p_business_id.
-- Rows are matched on SKU (insert or update); rows without SKU are inserted.
-- -----------------------------------------------------------------------------
create or replace function public.import_products(p_business_id uuid, p_rows jsonb)
returns table (inserted integer, updated integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency char(3);
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no rows to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'too many rows (max 2000)' using errcode = '54000';
  end if;

  select currency into v_currency from public.businesses where id = p_business_id;
  if v_currency is null then
    raise exception 'business not found' using errcode = '42501';
  end if;

  perform set_config('sellflow.stock_reason', 'import', true);

  return query
  with src as (
    select * from jsonb_to_recordset(p_rows) as r(
      name text, description text, sku text, price_minor bigint, stock_quantity integer,
      track_inventory boolean, category text, brand text, status public.product_status
    )
  ),
  upserted as (
    insert into public.products as p
      (business_id, name, description, sku, price_minor, currency, stock_quantity, track_inventory, category, brand, status)
    select p_business_id, s.name, s.description, nullif(s.sku, ''), s.price_minor, v_currency,
           coalesce(s.stock_quantity, 0), coalesce(s.track_inventory, true), s.category, s.brand,
           coalesce(s.status, 'active')
    from src s
    on conflict (business_id, sku) where sku is not null do update set
      name = excluded.name,
      description = coalesce(excluded.description, p.description),
      price_minor = excluded.price_minor,
      stock_quantity = excluded.stock_quantity,
      track_inventory = excluded.track_inventory,
      category = coalesce(excluded.category, p.category),
      brand = coalesce(excluded.brand, p.brand),
      status = excluded.status
    returning (xmax = 0) as was_inserted
  )
  select (count(*) filter (where was_inserted))::integer, (count(*) filter (where not was_inserted))::integer
  from upserted;
end;
$$;

revoke execute on function public.import_products(uuid, jsonb) from public, anon;
grant execute on function public.import_products(uuid, jsonb) to authenticated, service_role;
