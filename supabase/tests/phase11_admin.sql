-- Phase 11: platform stats, churn logging, complimentary plans, plan visibility. Rolls back.
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a011', 'owner11@example.com'),
  ('00000000-0000-0000-0000-00000000b011', 'owner11b@example.com');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a011', true);
do $$ begin insert into test.ids values ('a', public.create_business('Admin A')); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b011', true);
do $$ begin insert into test.ids values ('b', public.create_business('Admin B')); end $$;
reset role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
  growth uuid := (select id from public.subscription_plans where code = 'growth');
  base jsonb; r jsonb; sub_a uuid; sub_b uuid;
begin
  select id into sub_a from public.subscriptions where business_id = test.id('a');
  select id into sub_b from public.subscriptions where business_id = test.id('b');
  base := public.admin_platform_stats(now() - interval '1 day', now() + interval '1 hour');

  -- A pays for Growth: paying, counts toward MRR and revenue.
  insert into public.billing_invoices (business_id, subscription_id, plan_id, kind, amount_minor, currency, reference)
  values (test.id('a'), sub_a, growth, 'subscribe', 2490000, 'NGN', 'sfb-a11');
  perform public.apply_billing_payment('sfb-a11', 2490000, 'NGN', now(), null, '{}');

  -- B gets a complimentary Growth plan from an admin: active, but not revenue.
  update public.subscriptions set plan_id = growth, status = 'active', is_complimentary = true,
         current_period_start = now(), current_period_end = now() + interval '30 days' where id = sub_b;

  r := public.admin_platform_stats(now() - interval '1 day', now() + interval '1 hour');
  if (r ->> 'paying')::int - (base ->> 'paying')::int <> 1 then raise exception 'FAIL: paying %', r ->> 'paying'; end if;
  if (r ->> 'complimentary')::int - (base ->> 'complimentary')::int <> 1 then raise exception 'FAIL: complimentary'; end if;
  if (r ->> 'mrr_minor')::bigint - (base ->> 'mrr_minor')::bigint <> 2490000 then raise exception 'FAIL: mrr %', r ->> 'mrr_minor'; end if;
  if (r ->> 'sellflow_revenue_minor')::bigint - (base ->> 'sellflow_revenue_minor')::bigint <> 2490000 then raise exception 'FAIL: revenue'; end if;
  if (r ->> 'businesses_new')::int - (base ->> 'businesses_new')::int <> 0 or (r ->> 'businesses_new')::int < 2 then raise exception 'FAIL: new businesses %', r ->> 'businesses_new'; end if;

  -- Paying B for real clears the complimentary flag.
  insert into public.billing_invoices (business_id, subscription_id, plan_id, kind, amount_minor, currency, reference)
  values (test.id('b'), sub_b, growth, 'subscribe', 2490000, 'NGN', 'sfb-b11');
  perform public.apply_billing_payment('sfb-b11', 2490000, 'NGN', now(), null, '{}');
  if (select is_complimentary from public.subscriptions where id = sub_b) then raise exception 'FAIL: payment did not clear complimentary'; end if;

  -- Transitions are logged: A's grace ends (churn), a new trial expires (not churn).
  update public.subscriptions set status = 'past_due', past_due_since = now() - interval '4 days' where id = sub_a;
  perform public.advance_subscription_states();
  if not exists (select 1 from public.billing_events where subscription_id = sub_a and type = 'subscription.expired') then raise exception 'FAIL: expiry not logged'; end if;
  r := public.admin_platform_stats(now() - interval '1 day', now() + interval '1 hour');
  if (r ->> 'churned')::int - (base ->> 'churned')::int <> 1 then raise exception 'FAIL: churn %', r ->> 'churned'; end if;

  -- Suspending is allowed for the platform (service role).
  update public.businesses set status = 'suspended', suspended_reason = 'test' where id = test.id('b');
  r := public.admin_platform_stats(now() - interval '1 day', now() + interval '1 hour');
  if (r ->> 'businesses_suspended')::int - (base ->> 'businesses_suspended')::int <> 1 then raise exception 'FAIL: suspended count'; end if;

  -- Retire the Growth plan: hidden from the catalogue.
  update public.subscription_plans set is_public = false where id = growth;
end $$;
reset role;

-- Members still see their own (retired) plan, but not other hidden plans; admin stats are service-role only.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b011', true);
do $$
begin
  if not exists (select 1 from public.subscriptions s join public.subscription_plans p on p.id = s.plan_id where s.business_id = test.id('b') and p.code = 'growth') then
    raise exception 'FAIL: member cannot read their retired plan';
  end if;
  if (select count(*) from public.subscription_plans where code = 'growth') <> 1 then raise exception 'FAIL: own plan visibility'; end if;
  begin
    perform public.admin_platform_stats(now() - interval '1 day', now());
    raise exception 'FAIL: tenant read platform stats';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.businesses set status = 'active' where id = test.id('b');
    raise exception 'FAIL: owner lifted own suspension';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a011', true);
do $$
begin
  -- A (expired, on Growth too) sees Growth; a stranger's hidden plan would not be visible.
  if (select count(*) from public.subscription_plans where not is_public and code <> 'growth') <> 0 then raise exception 'FAIL: hidden plans leaked'; end if;
end $$;
reset role;

\echo 'ALL PHASE 11 TESTS PASSED'
rollback;
