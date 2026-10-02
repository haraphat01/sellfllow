-- =============================================================================
-- Phase 11: platform admin.
--   * Members can always read the plan their business is on (even after the
--     platform hides or retires it).
--   * Complimentary subscriptions (granted by an admin) are flagged so they
--     don't count as revenue; a real payment clears the flag.
--   * Subscription transitions are logged as billing_events (churn metrics).
--   * admin_platform_stats(): one service-role report for the admin overview.
-- =============================================================================

create policy subscription_plans_select_own on public.subscription_plans for select to authenticated
  using (exists (
    select 1 from public.subscriptions s
     where (s.plan_id = subscription_plans.id or s.pending_plan_id = subscription_plans.id)
       and (select private.is_member(s.business_id))
  ));

alter table public.subscriptions add column if not exists is_complimentary boolean not null default false;

create or replace function private.clear_complimentary_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    update public.subscriptions set is_complimentary = false where id = new.subscription_id and is_complimentary;
  end if;
  return new;
end;
$$;

create trigger billing_invoices_clear_complimentary after update of status on public.billing_invoices
  for each row execute function private.clear_complimentary_on_payment();

-- Same transitions as before, now recorded for churn reporting.
create or replace function public.advance_subscription_states(p_grace interval default interval '3 days')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial integer; v_cancelled integer; v_expired integer;
begin
  with t as (
    update public.subscriptions set status = 'expired'
     where status = 'trialing' and coalesce(trial_ends_at, current_period_end) <= now()
    returning id, business_id, plan_id
  ), ev as (
    insert into public.billing_events (business_id, subscription_id, type, payload)
    select business_id, id, 'subscription.trial_expired', jsonb_build_object('plan_id', plan_id) from t
    returning 1
  )
  select count(*) into v_trial from ev;

  with c as (
    update public.subscriptions set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now())
     where status in ('active', 'past_due') and cancel_at_period_end and current_period_end <= now()
    returning id, business_id, plan_id, is_complimentary
  ), ev as (
    insert into public.billing_events (business_id, subscription_id, type, payload)
    select business_id, id, 'subscription.cancelled', jsonb_build_object('plan_id', plan_id, 'complimentary', is_complimentary) from c
    returning 1
  )
  select count(*) into v_cancelled from ev;

  with e as (
    update public.subscriptions set status = 'expired'
     where (status = 'past_due' and past_due_since <= now() - p_grace)
        or (status = 'active' and current_period_end <= now() - p_grace)
    returning id, business_id, plan_id, is_complimentary
  ), ev as (
    insert into public.billing_events (business_id, subscription_id, type, payload)
    select business_id, id, 'subscription.expired', jsonb_build_object('plan_id', plan_id, 'complimentary', is_complimentary) from e
    returning 1
  )
  select count(*) into v_expired from ev;

  update public.billing_invoices i set status = 'void', failure_reason = coalesce(i.failure_reason, 'subscription ended')
    from public.subscriptions s
   where i.subscription_id = s.id and i.status = 'pending' and i.kind = 'renewal' and s.status in ('expired', 'cancelled');

  return jsonb_build_object('trials_expired', v_trial, 'cancelled', v_cancelled, 'expired', v_expired);
end;
$$;

create index if not exists messages_created_idx on public.messages (created_at);
create index if not exists orders_paid_idx on public.orders (paid_at) where paid_at is not null;
create index if not exists billing_events_type_created_idx on public.billing_events (type, created_at);

-- Platform-wide numbers for [p_from, p_to). Service role only (the app checks
-- is_platform_admin before calling).
create or replace function public.admin_platform_stats(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with subs as (
    select s.status, s.is_complimentary, p.price_minor, p.interval, p.currency, p.code
      from public.subscriptions s join public.subscription_plans p on p.id = s.plan_id
  ),
  paying as (select * from subs where status in ('active', 'past_due') and not is_complimentary)
  select jsonb_build_object(
    'businesses_total', (select count(*) from public.businesses),
    'businesses_active', (select count(*) from public.businesses where status = 'active'),
    'businesses_suspended', (select count(*) from public.businesses where status = 'suspended'),
    'businesses_new', (select count(*) from public.businesses where created_at >= p_from and created_at < p_to),
    'subscriptions', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from subs group by status) x), '{}'::jsonb),
    'paying', (select count(*) from paying),
    'complimentary', (select count(*) from subs where is_complimentary and status in ('active', 'past_due')),
    'paying_by_plan', coalesce((select jsonb_object_agg(code, n) from (select code, count(*) n from paying group by code) x), '{}'::jsonb),
    'mrr_minor', coalesce((select sum(case when interval = 'annually' then price_minor / 12 else price_minor end) from paying), 0),
    'sellflow_revenue_minor', coalesce((select sum(amount_minor) from public.billing_invoices where status = 'paid' and paid_at >= p_from and paid_at < p_to), 0),
    'churned', (select count(distinct business_id) from public.billing_events
                 where type in ('subscription.cancelled', 'subscription.expired') and not coalesce((payload ->> 'complimentary')::boolean, false)
                   and created_at >= p_from and created_at < p_to),
    'trials_expired', (select count(*) from public.billing_events where type = 'subscription.trial_expired' and created_at >= p_from and created_at < p_to),
    'renewals_failed', (select count(*) from public.billing_events where type = 'renewal.failed' and created_at >= p_from and created_at < p_to),
    'messages', (select count(*) from public.messages where created_at >= p_from and created_at < p_to),
    'messages_failed', (select count(*) from public.messages where status = 'failed' and created_at >= p_from and created_at < p_to),
    'ai_conversations_this_month', coalesce((select sum(quantity) from public.usage_records
                                              where metric = 'monthly_ai_conversations' and period_start = date_trunc('month', now() at time zone 'UTC')::date), 0),
    'ai_requests', (select count(*) from public.ai_usage where created_at >= p_from and created_at < p_to),
    'orders', (select count(*) from public.orders where created_at >= p_from and created_at < p_to and status <> 'draft'),
    'orders_paid', (select count(*) from public.orders where paid_at >= p_from and paid_at < p_to and status <> 'refunded'),
    'payment_volume', coalesce((select jsonb_object_agg(currency, total) from (
                         select currency, sum(total_minor) total from public.orders
                          where paid_at >= p_from and paid_at < p_to and status <> 'refunded' group by currency) x), '{}'::jsonb),
    'errors', jsonb_build_object(
      'whatsapp_events_failed', (select count(*) from public.whatsapp_events where received_at >= p_from and received_at < p_to and (status = 'failed' or (status = 'ignored' and attempts > 0))),
      'payment_events_failed', (select count(*) from public.payment_events where received_at >= p_from and received_at < p_to and status = 'failed'),
      'follow_ups_failed', (select count(*) from public.follow_ups where updated_at >= p_from and updated_at < p_to and status = 'failed'),
      'ai_handoffs_on_error', (select count(*) from public.conversation_events where type = 'handoff_requested' and data ->> 'reason' = 'ai_error' and created_at >= p_from and created_at < p_to)
    ),
    'whatsapp_accounts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.whatsapp_accounts group by status) x), '{}'::jsonb),
    'signups_daily', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from (
                        select (created_at at time zone 'UTC')::date d, count(*) n from public.businesses
                         where created_at >= p_from and created_at < p_to group by 1) x), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

revoke execute on function public.admin_platform_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_platform_stats(timestamptz, timestamptz) to service_role;
revoke execute on function private.clear_complimentary_on_payment() from public, anon, authenticated;
