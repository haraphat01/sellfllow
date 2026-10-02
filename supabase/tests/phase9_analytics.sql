-- Phase 9: lead logging, analytics definitions, access. Rolls back.
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'owner9@example.com'),
  ('00000000-0000-0000-0000-0000000000b9', 'staff9@example.com'),
  ('00000000-0000-0000-0000-0000000000c9', 'other9@example.com');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', true);
do $$ begin insert into test.ids values ('a', public.create_business('Analytics A')); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c9', true);
do $$ begin insert into test.ids values ('b', public.create_business('Analytics B')); end $$;
reset role;

insert into public.business_members (business_id, user_id, role, permissions)
values (test.id('a'), '00000000-0000-0000-0000-0000000000b9', 'staff', '{conversations.view}');

do $$
declare p uuid; q uuid; cust uuid; wa uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid;
begin
  insert into public.products (business_id, name, price_minor, stock_quantity) values (test.id('a'), 'Bag', 4500000, 10) returning id into p;
  insert into public.products (business_id, name, price_minor, stock_quantity) values (test.id('a'), 'Belt', 1000000, 10) returning id into q;
  insert into public.customers (business_id, wa_id, phone) values (test.id('a'), '2348000000900', '+2348000000900') returning id into cust;
  insert into public.whatsapp_accounts (business_id, waba_id, phone_number_id, status) values (test.id('a'), 'w9', 'pn9', 'connected') returning id into wa;
  -- c1..c4 are separate conversations (closed ones allow several per customer).
  insert into public.conversations (business_id, customer_id, whatsapp_account_id, status) values (test.id('a'), cust, wa, 'closed') returning id into c1;
  insert into public.conversations (business_id, customer_id, whatsapp_account_id, status) values (test.id('a'), cust, wa, 'closed') returning id into c2;
  insert into public.conversations (business_id, customer_id, whatsapp_account_id, status) values (test.id('a'), cust, wa, 'closed') returning id into c3;
  insert into public.conversations (business_id, customer_id, whatsapp_account_id, status, sales_outcome) values (test.id('a'), cust, wa, 'open', 'interested_not_purchased') returning id into c4;
  insert into test.ids values ('p', p), ('q', q), ('cust', cust), ('c1', c1), ('c2', c2), ('c3', c3), ('c4', c4);
end $$;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare o1 uuid; o2 uuid; o3 uuid; pay uuid; f uuid; r jsonb; n integer;
begin
  -- Leads are logged when intent is recorded (insert or change), once per transition.
  update public.conversations set sales_outcome = 'interested_not_purchased' where id in (test.id('c1'), test.id('c2'));
  update public.conversations set sales_outcome = 'interested_not_purchased' where id = test.id('c1');
  select count(*) into n from public.conversation_events where business_id = test.id('a') and type = 'purchase_intent';
  if n <> 3 then raise exception 'FAIL: expected 3 lead events, got %', n; end if;

  -- c1: AI-assisted sale.
  o1 := public.create_order(test.id('a'), test.id('cust'), test.id('c1'), jsonb_build_array(jsonb_build_object('product_id', test.id('p'), 'quantity', 1)), null, '1 Road', 'Ada', 'ai', true, 'a1');
  insert into public.payments (business_id, order_id, reference, amount_minor, currency) values (test.id('a'), o1, 'ref-a1', 4500000, 'NGN') returning id into pay;
  perform public.mark_payment_succeeded(test.id('a'), pay, 4500000, 'NGN', now(), 'card', '1', '{}');

  -- c2: recovered by a follow-up (staff-created order, so not AI-assisted).
  update public.ai_settings set follow_up_enabled = true where business_id = test.id('a');
  insert into public.follow_ups (business_id, conversation_id, customer_id, scheduled_for, status, sent_at)
  values (test.id('a'), test.id('c2'), test.id('cust'), now() - interval '2 hours', 'sent', now() - interval '1 hour') returning id into f;
  o2 := public.create_order(test.id('a'), test.id('cust'), test.id('c2'), jsonb_build_array(jsonb_build_object('product_id', test.id('q'), 'quantity', 2)), null, '1 Road', 'Ada', 'staff', false, 'a2');
  insert into public.payments (business_id, order_id, reference, amount_minor, currency) values (test.id('a'), o2, 'ref-a2', 2000000, 'NGN') returning id into pay;
  perform public.mark_payment_succeeded(test.id('a'), pay, 2000000, 'NGN', now(), 'card', '2', '{}');

  -- c3 (not a lead): paid then refunded — excluded from revenue.
  o3 := public.create_order(test.id('a'), test.id('cust'), test.id('c3'), jsonb_build_array(jsonb_build_object('product_id', test.id('q'), 'quantity', 1)), null, '1 Road', 'Ada', 'staff', false, 'a3');
  insert into public.payments (business_id, order_id, reference, amount_minor, currency) values (test.id('a'), o3, 'ref-a3', 1000000, 'NGN') returning id into pay;
  perform public.mark_payment_succeeded(test.id('a'), pay, 1000000, 'NGN', now(), 'card', '3', '{}');
  perform public.mark_payment_refunded(test.id('a'), pay, 1000000);

  -- Inbound + AI messages for activity counts.
  insert into public.messages (business_id, conversation_id, direction, sender, body, status) values
    (test.id('a'), test.id('c1'), 'inbound', 'customer', 'hi', 'received'),
    (test.id('a'), test.id('c1'), 'outbound', 'ai', 'hello', 'sent'),
    (test.id('a'), test.id('c4'), 'inbound', 'customer', 'price?', 'received');

  r := public.analytics_report(test.id('a'), now() - interval '1 day', now() + interval '1 hour');

  if (r ->> 'revenue_minor')::bigint <> 6500000 then raise exception 'FAIL: revenue %', r ->> 'revenue_minor'; end if;
  if (r ->> 'orders_paid')::int <> 2 then raise exception 'FAIL: orders_paid %', r ->> 'orders_paid'; end if;
  if (r ->> 'refunded_minor')::bigint <> 1000000 then raise exception 'FAIL: refunded %', r ->> 'refunded_minor'; end if;
  if (r ->> 'orders_created')::int <> 3 then raise exception 'FAIL: orders_created %', r ->> 'orders_created'; end if;
  if (r ->> 'leads')::int <> 3 then raise exception 'FAIL: leads %', r ->> 'leads'; end if;
  if (r ->> 'leads_converted')::int <> 2 then raise exception 'FAIL: converted %', r ->> 'leads_converted'; end if;
  if (r ->> 'ai_assisted_orders')::int <> 1 or (r ->> 'ai_assisted_revenue_minor')::bigint <> 4500000 then raise exception 'FAIL: ai-assisted %', r; end if;
  if (r ->> 'recovered_orders')::int <> 1 or (r ->> 'recovered_revenue_minor')::bigint <> 2000000 then raise exception 'FAIL: recovered %', r; end if;
  if (r ->> 'follow_ups_sent')::int <> 1 then raise exception 'FAIL: follow-ups sent'; end if;
  if (r ->> 'conversations_new')::int <> 4 or (r ->> 'conversations_active')::int <> 2 or (r ->> 'ai_conversations')::int <> 1 then raise exception 'FAIL: conversation counts %', r; end if;
  if (select sum((d ->> 'revenue_minor')::bigint) from jsonb_array_elements(r -> 'daily') d) <> 6500000 then raise exception 'FAIL: daily revenue does not add up'; end if;
  if (select sum((d ->> 'leads')::int) from jsonb_array_elements(r -> 'daily') d) <> 3 then raise exception 'FAIL: daily leads'; end if;
  if r -> 'top_products' -> 0 ->> 'name' <> 'Bag' or (r -> 'top_products' -> 1 ->> 'quantity')::int <> 2 then raise exception 'FAIL: top products %', r -> 'top_products'; end if;

  -- A period before any activity is empty; one bucket per local calendar day it touches.
  r := public.analytics_report(test.id('a'), '2026-01-10 23:00+00', '2026-01-20 23:00+00'); -- Lagos: 11 Jan 00:00 → 21 Jan 00:00
  if (r ->> 'revenue_minor')::bigint <> 0 or (r ->> 'leads')::int <> 0 or jsonb_array_length(r -> 'daily') <> 10 or r -> 'daily' -> 0 ->> 'day' <> '2026-01-11' then
    raise exception 'FAIL: empty period %', r -> 'daily';
  end if;

  -- Other tenant sees nothing of A.
  r := public.analytics_report(test.id('b'), now() - interval '1 day', now() + interval '1 hour');
  if (r ->> 'revenue_minor')::bigint <> 0 or (r ->> 'leads')::int <> 0 then raise exception 'FAIL: tenant leak %', r; end if;

  begin
    perform public.analytics_report(test.id('a'), now(), now() - interval '1 day');
    raise exception 'FAIL: reversed range accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- Access: owner yes; staff without analytics.view no, with it yes; another business's owner no.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', true);
do $$
begin
  if (public.analytics_report(test.id('a'), now() - interval '1 day', now() + interval '1 hour') ->> 'orders_paid')::int <> 2 then raise exception 'FAIL: owner report'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b9', true);
do $$
begin
  begin
    perform public.analytics_report(test.id('a'), now() - interval '1 day', now());
    raise exception 'FAIL: staff without analytics.view read analytics';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c9', true);
do $$
begin
  begin
    perform public.analytics_report(test.id('a'), now() - interval '1 day', now());
    raise exception 'FAIL: other business read analytics';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update public.business_members set permissions = '{analytics.view}' where user_id = '00000000-0000-0000-0000-0000000000b9';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b9', true);
do $$
begin
  if (public.analytics_report(test.id('a'), now() - interval '1 day', now() + interval '1 hour') ->> 'leads')::int <> 3 then raise exception 'FAIL: staff with analytics.view'; end if;
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform public.analytics_report(gen_random_uuid(), now() - interval '1 day', now());
    raise exception 'FAIL: anon read analytics';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'ALL PHASE 9 TESTS PASSED'
rollback;
