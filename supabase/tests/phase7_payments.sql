-- Phase 7: payment transitions. Rolls back.
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'a7@example.com');
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
do $$ begin insert into test.ids values ('a', public.create_business('Pay A')); end $$;
reset role;

do $$
declare p uuid; cust uuid; wa uuid; conv uuid;
begin
  insert into public.products (business_id, name, price_minor, stock_quantity) values (test.id('a'), 'Bag', 4600000, 5) returning id into p;
  insert into public.customers (business_id, wa_id, phone) values (test.id('a'), '2348000000700', '+2348000000700') returning id into cust;
  insert into public.whatsapp_accounts (business_id, waba_id, phone_number_id, status) values (test.id('a'), 'w7', 'pn7', 'connected') returning id into wa;
  insert into public.conversations (business_id, customer_id, whatsapp_account_id, sales_outcome, needs_attention) values (test.id('a'), cust, wa, 'interested_not_purchased', true) returning id into conv;
  insert into test.ids values ('p', p), ('cust', cust), ('conv', conv);
end $$;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare oid uuid; pay uuid; r jsonb; oid2 uuid; pay2 uuid;
begin
  oid := public.create_order(test.id('a'), test.id('cust'), test.id('conv'), jsonb_build_array(jsonb_build_object('product_id', test.id('p'), 'quantity', 1)), null, '12 Some Street', 'Ada', 'ai', true, 'k1');
  insert into public.payments (business_id, order_id, reference, amount_minor, currency) values (test.id('a'), oid, 'ref-1', 4600000, 'NGN') returning id into pay;

  -- Wrong amount is rejected; nothing changes.
  begin
    perform public.mark_payment_succeeded(test.id('a'), pay, 100, 'NGN', now(), 'card', '1', '{}');
    raise exception 'FAIL: amount mismatch accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select status from public.orders where id = oid) <> 'pending_payment' then raise exception 'FAIL: order changed on mismatch'; end if;

  -- Wrong currency rejected.
  begin
    perform public.mark_payment_succeeded(test.id('a'), pay, 4600000, 'USD', now(), 'card', '1', '{}');
    raise exception 'FAIL: currency mismatch accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Success: payment, order, customer, conversation updated together.
  r := public.mark_payment_succeeded(test.id('a'), pay, 4600000, 'ngn', now(), 'card', '123', '{"status":"success"}');
  if r ->> 'outcome' <> 'paid' then raise exception 'FAIL: outcome %', r; end if;
  if (select status from public.payments where id = pay) <> 'success' then raise exception 'FAIL: payment not success'; end if;
  if (select status from public.orders where id = oid) <> 'paid' or (select paid_at from public.orders where id = oid) is null then raise exception 'FAIL: order not paid'; end if;
  if (select row(total_orders, total_spend_minor, status::text) from public.customers where id = test.id('cust')) <> row(1, 4600000::bigint, 'customer'::text) then
    raise exception 'FAIL: customer totals %', (select row(total_orders, total_spend_minor, status) from public.customers where id = test.id('cust'));
  end if;
  if (select row(sales_outcome::text, purchase_stage::text, needs_attention) from public.conversations where id = test.id('conv')) <> row('purchased'::text, 'paid'::text, false) then
    raise exception 'FAIL: conversation not updated';
  end if;

  -- Replayed webhook: idempotent, totals not double-counted.
  r := public.mark_payment_succeeded(test.id('a'), pay, 4600000, 'NGN', now(), 'card', '123', '{}');
  if r ->> 'outcome' <> 'already_paid' then raise exception 'FAIL: replay outcome %', r; end if;
  if (select total_orders from public.customers where id = test.id('cust')) <> 1 then raise exception 'FAIL: replay double-counted'; end if;

  -- Second paid order → repeat customer.
  oid2 := public.create_order(test.id('a'), test.id('cust'), null, jsonb_build_array(jsonb_build_object('product_id', test.id('p'), 'quantity', 1)), null, '12 Some Street', 'Ada', 'staff', false, 'k2');
  insert into public.payments (business_id, order_id, reference, amount_minor, currency) values (test.id('a'), oid2, 'ref-2', 4600000, 'NGN') returning id into pay2;
  perform public.mark_payment_succeeded(test.id('a'), pay2, 4600000, 'NGN', now(), 'bank', '124', '{}');
  if (select status from public.customers where id = test.id('cust')) <> 'repeat_customer' then raise exception 'FAIL: repeat customer'; end if;

  -- Refund: order refunded, totals reduced, only once.
  if not public.mark_payment_refunded(test.id('a'), pay2, 4600000) then raise exception 'FAIL: refund'; end if;
  if (select status from public.orders where id = oid2) <> 'refunded' then raise exception 'FAIL: order not refunded'; end if;
  if (select row(total_orders, total_spend_minor) from public.customers where id = test.id('cust')) <> row(1, 4600000::bigint) then raise exception 'FAIL: refund totals'; end if;
  if public.mark_payment_refunded(test.id('a'), pay2, 4600000) then raise exception 'FAIL: double refund'; end if;

  -- Late payment for a cancelled (expired) order: recorded, order untouched, flagged.
  oid := public.create_order(test.id('a'), test.id('cust'), null, jsonb_build_array(jsonb_build_object('product_id', test.id('p'), 'quantity', 1)), null, '12 Some Street', 'Ada', 'ai', true, 'k3');
  insert into public.payments (business_id, order_id, reference, amount_minor, currency) values (test.id('a'), oid, 'ref-3', 4600000, 'NGN') returning id into pay;
  perform public.cancel_order(test.id('a'), oid, 'expired', null);
  r := public.mark_payment_succeeded(test.id('a'), pay, 4600000, 'NGN', now(), 'card', '125', '{}');
  if r ->> 'outcome' <> 'order_not_payable' then raise exception 'FAIL: late payment outcome %', r; end if;
  if (select status from public.orders where id = oid) <> 'cancelled' then raise exception 'FAIL: cancelled order changed'; end if;
  if not exists (select 1 from public.audit_logs where entity_id = oid and action = 'payment.received_for_unpayable_order') then raise exception 'FAIL: late payment not flagged'; end if;

  -- Failure marking never overrides success.
  if public.mark_payment_failed(test.id('a'), pay, 'abandoned', 'x') then raise exception 'FAIL: failed overrode success'; end if;
end $$;
reset role;

-- Dashboard users can't call payment transitions or write payments.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
do $$
begin
  begin
    perform public.mark_payment_succeeded(gen_random_uuid(), gen_random_uuid(), 1, 'NGN', now(), 'card', '1', '{}');
    raise exception 'FAIL: dashboard marked payment succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mark_payment_refunded(gen_random_uuid(), gen_random_uuid(), 1);
    raise exception 'FAIL: dashboard marked refund';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'ALL PHASE 7 TESTS PASSED'
rollback;
