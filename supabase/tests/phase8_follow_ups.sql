-- Phase 8: follow-up scheduling, stop conditions, claiming, recovery attribution. Rolls back.
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f8', 'a8@example.com');
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f8', true);
do $$ begin insert into test.ids values ('a', public.create_business('Follow A')); end $$;
reset role;

do $$
declare p uuid; cust uuid; wa uuid; conv uuid; cold uuid; cust2 uuid;
begin
  insert into public.products (business_id, name, price_minor, stock_quantity) values (test.id('a'), 'Bag', 4500000, 5) returning id into p;
  insert into public.customers (business_id, wa_id, phone) values (test.id('a'), '2348000000800', '+2348000000800') returning id into cust;
  insert into public.customers (business_id, wa_id, phone) values (test.id('a'), '2348000000801', '+2348000000801') returning id into cust2;
  insert into public.whatsapp_accounts (business_id, waba_id, phone_number_id, status) values (test.id('a'), 'w8', 'pn8', 'connected') returning id into wa;
  -- Interested lead, quiet for 5h.
  insert into public.conversations (business_id, customer_id, whatsapp_account_id, sales_outcome, purchase_stage, last_message_at, last_customer_message_at, purchase_intent_at, created_at)
  values (test.id('a'), cust, wa, 'interested_not_purchased', 'purchase_intent', now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours', now() - interval '6 hours')
  returning id into conv;
  -- Just browsing: never followed up.
  insert into public.conversations (business_id, customer_id, whatsapp_account_id, sales_outcome, last_message_at)
  values (test.id('a'), cust2, wa, 'none', now() - interval '5 hours') returning id into cold;
  insert into test.ids values ('p', p), ('cust', cust), ('conv', conv), ('cold', cold);
end $$;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare r jsonb; f uuid; oid uuid; pay uuid;
begin
  -- Automation off by default.
  if public.follow_up_stop_reason(test.id('conv')) <> 'automation_disabled' then raise exception 'FAIL: expected automation_disabled, got %', public.follow_up_stop_reason(test.id('conv')); end if;
  r := public.schedule_follow_ups();
  if (r ->> 'scheduled')::int <> 0 then raise exception 'FAIL: scheduled while disabled'; end if;

  -- Enabled, but the Starter plan doesn't include follow-ups.
  update public.ai_settings set follow_up_enabled = true, follow_up_max = 2, follow_up_delay_minutes = 240 where business_id = test.id('a');
  if public.follow_up_stop_reason(test.id('conv')) <> 'plan' then raise exception 'FAIL: expected plan, got %', public.follow_up_stop_reason(test.id('conv')); end if;
  update public.subscriptions set plan_id = (select id from public.subscription_plans where code = 'growth') where business_id = test.id('a');

  -- Eligible: exactly one follow-up, due 4h after the last message; browsing conversation untouched.
  if public.follow_up_stop_reason(test.id('conv')) is not null then raise exception 'FAIL: not eligible: %', public.follow_up_stop_reason(test.id('conv')); end if;
  if public.follow_up_stop_reason(test.id('cold')) <> 'no_purchase_intent' then raise exception 'FAIL: cold conversation eligible'; end if;
  r := public.schedule_follow_ups();
  if (r ->> 'scheduled')::int <> 1 then raise exception 'FAIL: expected 1 scheduled, got %', r; end if;
  select id into f from public.follow_ups where conversation_id = test.id('conv') and status = 'scheduled';
  if (select scheduled_for from public.follow_ups where id = f) <> now() - interval '1 hour' then raise exception 'FAIL: wrong due time %', (select scheduled_for from public.follow_ups where id = f); end if;
  if (select sequence_number from public.follow_ups where id = f) <> 1 then raise exception 'FAIL: sequence'; end if;
  r := public.schedule_follow_ups();
  if (r ->> 'scheduled')::int <> 0 or (select count(*) from public.follow_ups where conversation_id = test.id('conv')) <> 1 then raise exception 'FAIL: duplicate schedule'; end if;

  -- Claiming: once only, and never before it's due.
  update public.follow_ups set scheduled_for = now() + interval '1 hour' where id = f;
  if public.claim_follow_up(f, 'hi', 'text', null) then raise exception 'FAIL: claimed before due'; end if;
  update public.follow_ups set scheduled_for = now() - interval '1 minute' where id = f;
  if not public.claim_follow_up(f, 'Hi there', 'text', null) then raise exception 'FAIL: claim'; end if;
  if public.claim_follow_up(f, 'Hi there', 'text', null) then raise exception 'FAIL: double claim'; end if;
  if (select row(status::text, message, channel) from public.follow_ups where id = f) <> row('sent'::text, 'Hi there'::text, 'text'::text) then raise exception 'FAIL: claim fields'; end if;

  -- Sent (the send moved last_message_at past it): nothing new until the conversation has activity after the attempt.
  update public.follow_ups set created_at = now() - interval '2 hours', sent_at = now() - interval '2 hours' where id = f;
  update public.conversations set last_message_at = now() - interval '2 hours' + interval '1 second' where id = test.id('conv');
  r := public.schedule_follow_ups();
  if (r ->> 'scheduled')::int <> 1 then raise exception 'FAIL: second follow-up not scheduled: %', r; end if;
  if (select sequence_number from public.follow_ups where conversation_id = test.id('conv') and status = 'scheduled') <> 2 then raise exception 'FAIL: second sequence'; end if;

  -- A skipped attempt doesn't loop.
  update public.follow_ups set status = 'skipped', cancel_reason = 'window_closed', created_at = now() - interval '1 hour' where conversation_id = test.id('conv') and status = 'scheduled';
  r := public.schedule_follow_ups();
  if (r ->> 'scheduled')::int <> 0 then raise exception 'FAIL: rescheduled after skip without activity'; end if;

  -- Max reached after two sends in this episode.
  update public.follow_ups set status = 'sent', sent_at = now() - interval '1 hour' where conversation_id = test.id('conv') and status = 'skipped';
  update public.conversations set last_message_at = now() - interval '30 minutes' where id = test.id('conv');
  if public.follow_up_stop_reason(test.id('conv')) <> 'max_reached' then raise exception 'FAIL: expected max_reached, got %', public.follow_up_stop_reason(test.id('conv')); end if;
  update public.ai_settings set follow_up_max = 3 where business_id = test.id('a');

  -- Stop conditions cancel a pending follow-up.
  perform public.schedule_follow_ups();
  if not exists (select 1 from public.follow_ups where conversation_id = test.id('conv') and status = 'scheduled') then raise exception 'FAIL: third not scheduled'; end if;
  update public.customers set opted_out_at = now() where id = test.id('cust');
  r := public.schedule_follow_ups();
  if (r ->> 'cancelled')::int <> 1 then raise exception 'FAIL: opt-out did not cancel: %', r; end if;
  if (select cancel_reason from public.follow_ups where conversation_id = test.id('conv') order by created_at desc limit 1) <> 'opted_out' then raise exception 'FAIL: cancel reason'; end if;
  update public.customers set opted_out_at = null where id = test.id('cust');
  update public.conversations set ai_mode = 'HUMAN_ACTIVE' where id = test.id('conv');
  if public.follow_up_stop_reason(test.id('conv')) <> 'human_handling' then raise exception 'FAIL: human handoff not a stop'; end if;
  update public.conversations set ai_mode = 'AI_ACTIVE' where id = test.id('conv');

  -- Recovered sale: paid within the attribution window after a follow-up.
  update public.conversations set last_message_at = now() - interval '5 hours' where id = test.id('conv');
  perform public.schedule_follow_ups();
  oid := public.create_order(test.id('a'), test.id('cust'), test.id('conv'), jsonb_build_array(jsonb_build_object('product_id', test.id('p'), 'quantity', 1)), null, '1 Road', 'Ada', 'ai', true, 'f1');
  insert into public.payments (business_id, order_id, reference, amount_minor, currency) values (test.id('a'), oid, 'ref-f1', 4500000, 'NGN') returning id into pay;
  select id into f from public.follow_ups where conversation_id = test.id('conv') and status = 'sent' order by sent_at desc limit 1;
  r := public.mark_payment_succeeded(test.id('a'), pay, 4500000, 'NGN', now(), 'card', '1', '{}');
  if (r ->> 'recovered_by_follow_up_id')::uuid is distinct from f then raise exception 'FAIL: recovery attribution %', r; end if;
  if (select recovered_by_follow_up_id from public.orders where id = oid) is distinct from f then raise exception 'FAIL: order not attributed'; end if;
  if exists (select 1 from public.follow_ups where conversation_id = test.id('conv') and status = 'scheduled') then raise exception 'FAIL: pending follow-up survived payment'; end if;
  if public.follow_up_stop_reason(test.id('conv')) <> 'purchased' then raise exception 'FAIL: purchased not a stop'; end if;

  -- New intent episode after the purchase: the count starts again.
  update public.conversations set sales_outcome = 'interested_not_purchased' where id = test.id('conv');
  if public.follow_up_stop_reason(test.id('conv')) is not null then raise exception 'FAIL: new episode blocked: %', public.follow_up_stop_reason(test.id('conv')); end if;

  -- Outside the attribution window: not a recovered sale.
  update public.follow_ups set sent_at = now() - interval '100 hours' where conversation_id = test.id('conv') and status = 'sent';
  oid := public.create_order(test.id('a'), test.id('cust'), test.id('conv'), jsonb_build_array(jsonb_build_object('product_id', test.id('p'), 'quantity', 1)), null, '1 Road', 'Ada', 'ai', true, 'f2');
  insert into public.payments (business_id, order_id, reference, amount_minor, currency) values (test.id('a'), oid, 'ref-f2', 4500000, 'NGN') returning id into pay;
  r := public.mark_payment_succeeded(test.id('a'), pay, 4500000, 'NGN', now(), 'card', '2', '{}');
  if r ->> 'recovered_by_follow_up_id' is not null then raise exception 'FAIL: stale follow-up credited %', r; end if;
end $$;
reset role;

-- Dashboard users can't run the scheduler or claim follow-ups.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f8', true);
do $$
begin
  begin
    perform public.schedule_follow_ups();
    raise exception 'FAIL: dashboard ran scheduler';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_follow_up(gen_random_uuid(), 'x', 'text', null);
    raise exception 'FAIL: dashboard claimed follow-up';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.follow_up_stop_reason(gen_random_uuid());
    raise exception 'FAIL: dashboard called stop reason';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'ALL PHASE 8 TESTS PASSED'
rollback;
