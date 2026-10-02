-- Phase 10: subscription billing transitions and access. Rolls back.
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a010', 'owner10@example.com'),
  ('00000000-0000-0000-0000-00000000b010', 'staff10@example.com'),
  ('00000000-0000-0000-0000-00000000c010', 'other10@example.com');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a010', true);
do $$ begin insert into test.ids values ('a', public.create_business('Billing A')); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c010', true);
do $$ begin insert into test.ids values ('b', public.create_business('Billing B')); end $$;
reset role;
insert into public.business_members (business_id, user_id, role, permissions)
values (test.id('a'), '00000000-0000-0000-0000-00000000b010', 'staff', '{conversations.view}');
insert into test.ids select 'sub_a', id from public.subscriptions where business_id = test.id('a');
insert into test.ids select 'sub_b', id from public.subscriptions where business_id = test.id('b');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
  growth uuid := (select id from public.subscription_plans where code = 'growth');
  pro uuid := (select id from public.subscription_plans where code = 'pro');
  starter uuid := (select id from public.subscription_plans where code = 'starter');
  r jsonb; inv uuid; stale uuid; end_before timestamptz; paid timestamptz := now() - interval '1 hour';
begin
  if (select status from public.subscriptions where id = test.id('sub_a')) <> 'trialing' then raise exception 'FAIL: new business not trialing'; end if;

  -- Two checkouts open (e.g. two tabs); the paid one wins, the other is voided.
  insert into public.billing_invoices (business_id, subscription_id, plan_id, kind, amount_minor, currency, reference)
  values (test.id('a'), test.id('sub_a'), growth, 'subscribe', 2490000, 'NGN', 'sfb-1') returning id into inv;
  insert into public.billing_invoices (business_id, subscription_id, plan_id, kind, amount_minor, currency, reference)
  values (test.id('a'), test.id('sub_a'), pro, 'subscribe', 5990000, 'NGN', 'sfb-2') returning id into stale;

  begin
    perform public.apply_billing_payment('sfb-1', 100, 'NGN', paid, null, '{}');
    raise exception 'FAIL: wrong amount accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select status from public.billing_invoices where id = inv) <> 'pending' then raise exception 'FAIL: invoice changed on mismatch'; end if;

  r := public.apply_billing_payment('sfb-1', 2490000, 'ngn', paid, '{"brand":"visa","last4":"4081","exp":"12/30"}', '{}');
  if r ->> 'outcome' <> 'applied' or r ->> 'plan_code' <> 'growth' then raise exception 'FAIL: subscribe %', r; end if;
  if (select row(plan_id, status::text, current_period_start, current_period_end, card_last4) from public.subscriptions where id = test.id('sub_a'))
     <> row(growth, 'active'::text, paid, paid + interval '1 month', '4081'::text) then
    raise exception 'FAIL: subscription after subscribe %', (select row(plan_id, status, current_period_start, current_period_end, card_last4) from public.subscriptions where id = test.id('sub_a'));
  end if;
  if (select status from public.billing_invoices where id = stale) <> 'void' then raise exception 'FAIL: stale checkout not voided'; end if;
  if public.apply_billing_payment('sfb-1', 2490000, 'NGN', paid, null, '{}') ->> 'outcome' <> 'already_paid' then raise exception 'FAIL: replay'; end if;

  -- Paying a voided checkout is recorded but doesn't change the plan.
  r := public.apply_billing_payment('sfb-2', 5990000, 'NGN', now(), null, '{}');
  if r ->> 'outcome' <> 'void_paid' or (select plan_id from public.subscriptions where id = test.id('sub_a')) <> growth then raise exception 'FAIL: void paid %', r; end if;
  if not exists (select 1 from public.billing_events where business_id = test.id('a') and type = 'invoice.paid_after_void') then raise exception 'FAIL: void payment not flagged'; end if;

  -- Upgrade: immediate, same period.
  select current_period_end into end_before from public.subscriptions where id = test.id('sub_a');
  insert into public.billing_invoices (business_id, subscription_id, plan_id, kind, amount_minor, currency, reference)
  values (test.id('a'), test.id('sub_a'), pro, 'upgrade', 3400000, 'NGN', 'sfb-3');
  perform public.apply_billing_payment('sfb-3', 3400000, 'NGN', now(), null, '{}');
  if (select row(plan_id, current_period_end) from public.subscriptions where id = test.id('sub_a')) <> row(pro, end_before) then raise exception 'FAIL: upgrade'; end if;

  -- Downgrade scheduled, applied by the next renewal.
  perform public.set_subscription_schedule(test.id('a'), false, 'starter');
  if (select pending_plan_id from public.subscriptions where id = test.id('sub_a')) <> starter then raise exception 'FAIL: downgrade not scheduled'; end if;
  insert into public.billing_invoices (business_id, subscription_id, plan_id, kind, amount_minor, currency, reference, period_start, period_end)
  values (test.id('a'), test.id('sub_a'), starter, 'renewal', 990000, 'NGN', 'sfb-4', end_before, end_before + interval '1 month') returning id into inv;
  begin
    insert into public.billing_invoices (business_id, subscription_id, plan_id, kind, amount_minor, currency, reference, period_start, period_end)
    values (test.id('a'), test.id('sub_a'), starter, 'renewal', 990000, 'NGN', 'sfb-4b', end_before, end_before + interval '1 month');
    raise exception 'FAIL: two renewal invoices for one period';
  exception when unique_violation then null;
  end;

  -- Renewal fails first: past_due (still usable), then succeeds.
  perform public.mark_renewal_failed(inv, 'Insufficient funds', now() + interval '1 day');
  if (select row(status::text, renewal_attempts) from public.subscriptions where id = test.id('sub_a')) <> row('past_due'::text, 1) then raise exception 'FAIL: past_due'; end if;
  perform public.apply_billing_payment('sfb-4', 990000, 'NGN', now(), null, '{}');
  if (select row(plan_id, status::text, current_period_start, current_period_end, pending_plan_id, past_due_since, renewal_attempts) from public.subscriptions where id = test.id('sub_a'))
     is distinct from row(starter, 'active'::text, end_before, end_before + interval '1 month', null::uuid, null::timestamptz, 0) then
    raise exception 'FAIL: renewal applied %', (select row(plan_id, status, current_period_start, current_period_end, pending_plan_id, past_due_since, renewal_attempts) from public.subscriptions where id = test.id('sub_a'));
  end if;

  -- Grace period over → expired. Trial over → expired. Cancel at period end → cancelled.
  update public.subscriptions set status = 'past_due', past_due_since = now() - interval '4 days' where id = test.id('sub_a');
  update public.subscriptions set trial_ends_at = now() - interval '1 minute' where id = test.id('sub_b');
  r := public.advance_subscription_states();
  if (select status from public.subscriptions where id = test.id('sub_a')) <> 'expired' then raise exception 'FAIL: grace expiry'; end if;
  if (select status from public.subscriptions where id = test.id('sub_b')) <> 'expired' then raise exception 'FAIL: trial expiry'; end if;
  if (r ->> 'trials_expired')::int < 1 or (r ->> 'expired')::int < 1 then raise exception 'FAIL: counts %', r; end if;

  update public.subscriptions set status = 'active', cancel_at_period_end = true, current_period_end = now() - interval '1 minute' where id = test.id('sub_a');
  perform public.advance_subscription_states();
  if (select row(status::text, cancelled_at is not null) from public.subscriptions where id = test.id('sub_a')) <> row('cancelled'::text, true) then raise exception 'FAIL: cancel at period end'; end if;
  begin
    perform public.set_subscription_schedule(test.id('a'), true, null);
    raise exception 'FAIL: scheduled change on cancelled subscription';
  exception when no_data_found then null;
  end;

  -- Resubscribing after cancellation starts a fresh period.
  insert into public.billing_invoices (business_id, subscription_id, plan_id, kind, amount_minor, currency, reference)
  values (test.id('a'), test.id('sub_a'), growth, 'subscribe', 2490000, 'NGN', 'sfb-5');
  perform public.apply_billing_payment('sfb-5', 2490000, 'NGN', now(), null, '{}');
  if (select row(status::text, cancel_at_period_end, cancelled_at) from public.subscriptions where id = test.id('sub_a')) is distinct from row('active'::text, false, null::timestamptz) then raise exception 'FAIL: resubscribe'; end if;

  -- Grace period keeps automation running.
  update public.subscriptions set status = 'past_due', past_due_since = now() where id = test.id('sub_a');
  update public.ai_settings set follow_up_enabled = true where business_id = test.id('a');
  if public.follow_up_stop_reason((select c.id from public.conversations c where c.business_id = test.id('a') limit 1)) = 'plan' then raise exception 'FAIL: past_due blocked follow-ups'; end if;
end $$;
reset role;

-- Access: owner reads invoices, can't write them or call billing functions; staff and other tenants see nothing.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a010', true);
do $$
begin
  if (select count(*) from public.billing_invoices) <> 5 then raise exception 'FAIL: owner sees % invoices', (select count(*) from public.billing_invoices); end if;
  begin
    update public.billing_invoices set status = 'paid' where reference = 'sfb-1';
    raise exception 'FAIL: owner updated invoice';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.apply_billing_payment('sfb-1', 1, 'NGN', now(), null, '{}');
    raise exception 'FAIL: owner applied payment';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_subscription_schedule(test.id('a'), true, null);
    raise exception 'FAIL: owner called schedule directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.subscriptions set status = 'active' where business_id = test.id('a');
    if exists (select 1 from public.subscriptions where business_id = test.id('a') and status = 'active') then raise exception 'FAIL: owner changed subscription'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b010', true);
do $$ begin if (select count(*) from public.billing_invoices) <> 0 then raise exception 'FAIL: staff sees invoices'; end if; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c010', true);
do $$ begin if (select count(*) from public.billing_invoices) <> 0 then raise exception 'FAIL: other tenant sees invoices'; end if; end $$;
reset role;

\echo 'ALL PHASE 10 TESTS PASSED'
rollback;
