-- =============================================================================
-- Tenant isolation & integrity tests. Runs in a transaction and rolls back.
-- Any failed assertion raises and aborts with a non-zero psql exit code.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_tenant_isolation.sql
-- =============================================================================
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;

create function test.id(p_k text) returns uuid language sql stable as $$
  select v from test.ids where k = p_k
$$;
grant execute on function test.id(text) to authenticated, service_role, anon;

-- Users
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'aisha@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'gadgets@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'staff@example.com');

-- ---------------------------------------------------------------------------
-- Aisha creates "Aisha Fashion"
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare b uuid;
begin
  b := public.create_business('Aisha Fashion', 'fashion');
  insert into test.ids values ('biz_a', b);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into public.products (business_id, name, price_minor, stock_quantity)
values (test.id('biz_a'), 'Black Leather Bag', 4500000, 20);
reset role;

-- ---------------------------------------------------------------------------
-- Lagos Gadgets
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare b uuid;
begin
  b := public.create_business('Lagos Gadgets', 'electronics');
  insert into test.ids values ('biz_b', b);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Service role: WhatsApp account, customer, conversation, order for A
-- ---------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare wa uuid; cust uuid; conv uuid; ord uuid; prod uuid;
begin
  insert into public.whatsapp_accounts (business_id, waba_id, phone_number_id, status)
  values (test.id('biz_a'), 'waba_a', 'pnid_a', 'connected') returning id into wa;
  insert into public.whatsapp_accounts (business_id, waba_id, phone_number_id, status)
  values (test.id('biz_b'), 'waba_b', 'pnid_b', 'connected');

  insert into public.customers (business_id, wa_id, phone, name)
  values (test.id('biz_a'), '2348000000001', '+2348000000001', 'Sarah') returning id into cust;
  insert into public.conversations (business_id, customer_id, whatsapp_account_id)
  values (test.id('biz_a'), cust, wa) returning id into conv;
  insert into public.messages (business_id, conversation_id, direction, sender, body, wa_message_id, status)
  values (test.id('biz_a'), conv, 'inbound', 'customer', 'Hi, how much is the black bag?', 'wamid.1', 'received');

  select id into prod from public.products where business_id = test.id('biz_a') limit 1;
  insert into public.orders (business_id, customer_id, conversation_id, subtotal_minor, delivery_fee_minor, total_minor,
                             customer_name, customer_phone, source, ai_assisted)
  values (test.id('biz_a'), cust, conv, 4500000, 300000, 4800000, 'Sarah', '+2348000000001', 'ai', true)
  returning id into ord;
  insert into public.order_items (business_id, order_id, product_id, name, unit_price_minor, quantity, total_minor)
  values (test.id('biz_a'), ord, prod, 'Black Leather Bag', 4500000, 1, 4500000);

  insert into public.business_credentials (business_id, provider, ciphertext)
  values (test.id('biz_a'), 'whatsapp', 'v1:ciphertext');

  insert into test.ids values ('cust_a', cust), ('conv_a', conv), ('order_a', ord), ('wa_a', wa), ('prod_a', prod);

  -- Order number assigned per business
  if (select order_number from public.orders where id = ord) <> 1001 then
    raise exception 'FAIL: order number not assigned';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 1. Business B cannot see or touch Business A's data
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare n int;
begin
  select count(*) into n from public.businesses where id = test.id('biz_a');
  if n <> 0 then raise exception 'FAIL: B can see business A'; end if;

  select count(*) into n from public.products where business_id = test.id('biz_a');
  if n <> 0 then raise exception 'FAIL: B can see A products'; end if;

  select count(*) into n from public.customers;
  if n <> 0 then raise exception 'FAIL: B can see A customers'; end if;

  select count(*) into n from public.conversations;
  if n <> 0 then raise exception 'FAIL: B can see A conversations'; end if;

  select count(*) into n from public.messages;
  if n <> 0 then raise exception 'FAIL: B can see A messages'; end if;

  select count(*) into n from public.orders;
  if n <> 0 then raise exception 'FAIL: B can see A orders'; end if;

  select count(*) into n from public.whatsapp_accounts where business_id = test.id('biz_a');
  if n <> 0 then raise exception 'FAIL: B can see A whatsapp account'; end if;

  select count(*) into n from public.ai_settings where business_id = test.id('biz_a');
  if n <> 0 then raise exception 'FAIL: B can see A AI settings'; end if;

  select count(*) into n from public.business_members where business_id = test.id('biz_a');
  if n <> 0 then raise exception 'FAIL: B can see A staff'; end if;

  select count(*) into n from public.profiles where id = '00000000-0000-0000-0000-00000000000a';
  if n <> 0 then raise exception 'FAIL: B can see A owner profile'; end if;

  -- B sees its own business
  select count(*) into n from public.businesses where id = test.id('biz_b');
  if n <> 1 then raise exception 'FAIL: B cannot see own business'; end if;

  update public.products set price_minor = 1 where business_id = test.id('biz_a');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A product'; end if;

  delete from public.products where business_id = test.id('biz_a');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A product'; end if;

  begin
    insert into public.products (business_id, name, price_minor) values (test.id('biz_a'), 'Injected', 1);
    raise exception 'FAIL: B inserted product into A';
  exception when insufficient_privilege then null;
  end;

  -- Moving own product into another tenant is refused.
  insert into public.products (business_id, name, price_minor) values (test.id('biz_b'), 'Phone', 1000);
  begin
    update public.products set business_id = test.id('biz_a') where business_id = test.id('biz_b');
    raise exception 'FAIL: B moved product into A';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 2. Owner A: sees own data, cannot see credentials, cannot mark order paid
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
declare n int;
begin
  select count(*) into n from public.products where business_id = test.id('biz_a');
  if n <> 1 then raise exception 'FAIL: A cannot see own product (%)', n; end if;

  select count(*) into n from public.messages;
  if n <> 1 then raise exception 'FAIL: A cannot see own messages'; end if;

  begin
    select count(*) into n from public.business_credentials;
    if n <> 0 then raise exception 'FAIL: credentials readable by owner'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    select count(*) into n from public.whatsapp_events;
    if n <> 0 then raise exception 'FAIL: webhook events readable'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    update public.orders set status = 'paid', paid_at = now() where id = test.id('order_a');
    raise exception 'FAIL: owner marked order paid';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  begin
    update public.orders set total_minor = 1, subtotal_minor = 1, delivery_fee_minor = 0 where id = test.id('order_a');
    raise exception 'FAIL: owner changed order totals';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  begin
    update public.orders set status = 'shipped' where id = test.id('order_a');
    raise exception 'FAIL: unpaid order shipped';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- Payments are not writable from the dashboard at all.
  begin
    insert into public.payments (business_id, order_id, reference, amount_minor, currency, status)
    values (test.id('biz_a'), test.id('order_a'), 'fake-ref', 4800000, 'NGN', 'success');
    raise exception 'FAIL: owner inserted payment';
  exception when insufficient_privilege then null;
  end;

  -- Messages cannot be forged from the dashboard (sent via server only).
  begin
    insert into public.messages (business_id, conversation_id, direction, sender, body, status)
    values (test.id('biz_a'), test.id('conv_a'), 'outbound', 'staff', 'x', 'sent');
    raise exception 'FAIL: owner inserted message directly';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set is_platform_admin = true where id = (select auth.uid());
    raise exception 'FAIL: self-promotion to platform admin';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  begin
    update public.businesses set status = 'active', suspended_reason = 'x' where id = test.id('biz_a');
    raise exception 'FAIL: owner changed business status';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  begin
    perform public.record_usage(test.id('biz_a'), 'messages', -1000);
    raise exception 'FAIL: authenticated can call record_usage';
  exception when insufficient_privilege then null;
  end;

  -- Pause AI (allowed)
  update public.conversations set ai_mode = 'HUMAN_ACTIVE' where id = test.id('conv_a');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: owner cannot take over conversation'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 3. Staff permissions
-- ---------------------------------------------------------------------------
insert into public.business_members (business_id, user_id, role, permissions)
values (test.id('biz_a'), '00000000-0000-0000-0000-00000000000c', 'staff', array['conversations.view']);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare n int;
begin
  select count(*) into n from public.messages;
  if n <> 1 then raise exception 'FAIL: staff with conversations.view cannot read messages'; end if;

  select count(*) into n from public.orders;
  if n <> 0 then raise exception 'FAIL: staff without orders.view can see orders'; end if;

  select count(*) into n from public.customers;
  if n <> 0 then raise exception 'FAIL: staff without customers.view can see customers'; end if;

  begin
    insert into public.products (business_id, name, price_minor) values (test.id('biz_a'), 'Nope', 1);
    raise exception 'FAIL: staff without products.manage inserted product';
  exception when insufficient_privilege then null;
  end;

  update public.conversations set ai_mode = 'AI_ACTIVE' where id = test.id('conv_a');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: staff without conversations.reply changed AI mode'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Service role integrity: paid transition, cross-tenant children, idempotency
-- ---------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare n bigint;
begin
  update public.orders set status = 'paid', paid_at = now() where id = test.id('order_a');

  -- Cross-tenant child rows are rejected even for the service role.
  begin
    insert into public.messages (business_id, conversation_id, direction, sender, body, status)
    values (test.id('biz_b'), test.id('conv_a'), 'outbound', 'ai', 'leak', 'queued');
    raise exception 'FAIL: cross-tenant message accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  begin
    insert into public.orders (business_id, customer_id, subtotal_minor, total_minor, customer_name, customer_phone)
    values (test.id('biz_b'), test.id('cust_a'), 1, 1, 'x', 'y');
    raise exception 'FAIL: cross-tenant order accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- Duplicate Meta message id rejected.
  begin
    insert into public.messages (business_id, conversation_id, direction, sender, body, wa_message_id, status)
    values (test.id('biz_a'), test.id('conv_a'), 'inbound', 'customer', 'dup', 'wamid.1', 'received');
    raise exception 'FAIL: duplicate wa_message_id accepted';
  exception when unique_violation then null;
  end;

  -- Duplicate webhook event rejected.
  insert into public.whatsapp_events (event_key, event_type, payload) values ('msg:wamid.1', 'message', '{}');
  begin
    insert into public.whatsapp_events (event_key, event_type, payload) values ('msg:wamid.1', 'message', '{}');
    raise exception 'FAIL: duplicate webhook event accepted';
  exception when unique_violation then null;
  end;

  -- Order totals must be consistent.
  begin
    insert into public.orders (business_id, customer_id, subtotal_minor, delivery_fee_minor, total_minor, customer_name, customer_phone)
    values (test.id('biz_a'), test.id('cust_a'), 100, 50, 999, 'x', 'y');
    raise exception 'FAIL: inconsistent order total accepted';
  exception when check_violation then null;
  end;

  -- Usage metering dedupes per subject.
  perform public.record_usage(test.id('biz_a'), 'monthly_ai_conversations', 1, 'conv-1');
  perform public.record_usage(test.id('biz_a'), 'monthly_ai_conversations', 1, 'conv-1');
  n := public.record_usage(test.id('biz_a'), 'monthly_ai_conversations', 1, 'conv-2');
  if n <> 2 then raise exception 'FAIL: usage dedupe returned %', n; end if;

  -- Only one open conversation per customer per number.
  begin
    insert into public.conversations (business_id, customer_id, whatsapp_account_id)
    values (test.id('biz_a'), test.id('cust_a'), test.id('wa_a'));
    raise exception 'FAIL: second open conversation accepted';
  exception when unique_violation then null;
  end;

  -- phone_number_id routes to exactly one business.
  begin
    insert into public.whatsapp_accounts (business_id, waba_id, phone_number_id) values (test.id('biz_b'), 'w', 'pnid_a');
    raise exception 'FAIL: phone_number_id reused across tenants';
  exception when unique_violation then null;
  end;
end $$;
reset role;

-- Trial subscription + default AI config were provisioned.
do $$
begin
  if (select count(*) from public.subscriptions s join public.subscription_plans p on p.id = s.plan_id
      where s.business_id = test.id('biz_a') and p.code = 'starter' and s.status = 'trialing') <> 1 then
    raise exception 'FAIL: trial subscription missing';
  end if;
  if not exists (select 1 from public.ai_agents where business_id = test.id('biz_a')) then
    raise exception 'FAIL: ai agent missing';
  end if;
end $$;

-- Anonymous: nothing but public plans.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
do $$
declare n int;
begin
  select count(*) into n from public.businesses;
  if n <> 0 then raise exception 'FAIL: anon sees businesses'; end if;
  select count(*) into n from public.subscription_plans;
  if n <> 3 then raise exception 'FAIL: anon cannot read public plans (%)', n; end if;
  begin
    perform public.create_business('Anon Biz');
    raise exception 'FAIL: anon created a business';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'ALL TENANT ISOLATION TESTS PASSED'
rollback;
