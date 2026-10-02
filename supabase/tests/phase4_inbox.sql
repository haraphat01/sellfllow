-- =============================================================================
-- Phase 4: inbox permissions (notes, AI mode, tags, visibility). Rolls back.
-- =============================================================================
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner4@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'agent4@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'viewer4@example.com'),
  ('00000000-0000-0000-0000-0000000000c9', 'outsider4@example.com');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$ begin insert into test.ids values ('biz', public.create_business('Inbox Test Co')); end $$;
reset role;

-- Service role: members, a conversation.
do $$
declare wa uuid; cust uuid; conv uuid;
begin
  insert into public.business_members (business_id, user_id, role, permissions) values
    (test.id('biz'), '00000000-0000-0000-0000-0000000000c2', 'staff', '{conversations.view,conversations.reply,customers.view}'),
    (test.id('biz'), '00000000-0000-0000-0000-0000000000c3', 'staff', '{conversations.view}');
  insert into public.whatsapp_accounts (business_id, waba_id, phone_number_id, status) values (test.id('biz'), 'w4', 'pn4', 'connected') returning id into wa;
  insert into public.customers (business_id, wa_id, phone) values (test.id('biz'), '2348000000444', '+2348000000444') returning id into cust;
  insert into public.conversations (business_id, customer_id, whatsapp_account_id) values (test.id('biz'), cust, wa) returning id into conv;
  insert into test.ids values ('conv', conv), ('cust', cust);
end $$;

-- Agent (reply, no customers.manage)
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);
do $$
declare n int;
begin
  -- Can take over and add a note as themselves.
  update public.conversations set ai_mode = 'HUMAN_ACTIVE', assigned_to = auth.uid() where id = test.id('conv');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: agent cannot take over'; end if;

  insert into public.conversation_events (business_id, conversation_id, type, actor_type, actor_user_id, data)
  values (test.id('biz'), test.id('conv'), 'note', 'user', auth.uid(), '{"text":"hi"}');

  -- Cannot post a note as someone else, or as the AI.
  begin
    insert into public.conversation_events (business_id, conversation_id, type, actor_type, actor_user_id, data)
    values (test.id('biz'), test.id('conv'), 'note', 'user', '00000000-0000-0000-0000-0000000000c1', '{"text":"spoof"}');
    raise exception 'FAIL: note spoofed as another user';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.conversation_events (business_id, conversation_id, type, actor_type, actor_user_id, data)
    values (test.id('biz'), test.id('conv'), 'handoff_requested', 'ai', auth.uid(), '{}');
    raise exception 'FAIL: event spoofed as AI';
  exception when insufficient_privilege then null;
  end;

  -- Cannot tag or edit customers without customers.manage.
  begin
    insert into public.customer_tags (business_id, customer_id, tag) values (test.id('biz'), test.id('cust'), 'vip');
    raise exception 'FAIL: agent tagged customer';
  exception when insufficient_privilege then null;
  end;
  update public.customers set name = 'Hacked' where id = test.id('cust');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: agent edited customer'; end if;

  -- Column privileges: server-computed fields are not writable from the dashboard.
  begin
    update public.conversations set purchase_stage = 'paid' where id = test.id('conv');
    raise exception 'FAIL: agent changed purchase_stage';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.conversations set state = '{"product_id":"x"}' where id = test.id('conv');
    raise exception 'FAIL: agent changed AI state';
  exception when insufficient_privilege then null;
  end;

  -- Cannot insert messages directly (sending goes through the server).
  begin
    insert into public.messages (business_id, conversation_id, direction, sender, body, status)
    values (test.id('biz'), test.id('conv'), 'outbound', 'staff', 'x', 'sent');
    raise exception 'FAIL: agent inserted message';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Viewer (conversations.view only): reads, cannot act.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
do $$
declare n int;
begin
  select count(*) into n from public.conversation_events where conversation_id = test.id('conv');
  if n <> 1 then raise exception 'FAIL: viewer cannot read notes (%)', n; end if;

  update public.conversations set ai_mode = 'AI_ACTIVE' where id = test.id('conv');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: viewer changed AI mode'; end if;

  update public.conversations set unread_count = 0 where id = test.id('conv');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: viewer updated conversation'; end if;

  begin
    insert into public.conversation_events (business_id, conversation_id, type, actor_type, actor_user_id, data)
    values (test.id('biz'), test.id('conv'), 'note', 'user', auth.uid(), '{"text":"x"}');
    raise exception 'FAIL: viewer added note';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Owner (customers.manage) can edit profile fields but not totals.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$
declare n int;
begin
  update public.customers set name = 'Ada', status = 'interested' where id = test.id('cust');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: owner cannot edit customer profile'; end if;
  begin
    update public.customers set total_spend_minor = 999999999 where id = test.id('cust');
    raise exception 'FAIL: owner inflated customer spend';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.customers (business_id, wa_id, phone) values (test.id('biz'), '2340000000000', '+2340000000000');
    raise exception 'FAIL: dashboard inserted customer';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Outsider sees nothing.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c9', true);
do $$
begin
  if exists (select 1 from public.conversations) or exists (select 1 from public.conversation_events) or exists (select 1 from public.customers) then
    raise exception 'FAIL: outsider sees inbox data';
  end if;
end $$;
reset role;

\echo 'ALL PHASE 4 TESTS PASSED'
rollback;
