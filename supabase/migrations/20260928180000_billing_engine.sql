-- =============================================================================
-- Phase 10: SellFlow subscription billing (platform Paystack account).
--
--   * Every charge is a billing_invoices row (subscribe | upgrade | renewal).
--   * A plan changes only through apply_billing_payment(), called after the
--     payment was verified server-side with Paystack. Service role only.
--   * Renewals are charged by SellFlow (saved card authorization); failures
--     make the subscription past_due, which stays usable for a grace period
--     before it expires.
-- =============================================================================

alter table public.subscriptions
  add column if not exists pending_plan_id uuid references public.subscription_plans (id),
  add column if not exists billing_email text,
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists card_exp text,
  add column if not exists past_due_since timestamptz,
  add column if not exists renewal_attempts integer not null default 0,
  add column if not exists next_renewal_attempt_at timestamptz;

create type public.invoice_status as enum ('pending', 'paid', 'failed', 'void');
create type public.invoice_kind as enum ('subscribe', 'upgrade', 'renewal');

create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  plan_id uuid not null references public.subscription_plans (id),
  kind public.invoice_kind not null,
  status public.invoice_status not null default 'pending',
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  reference text not null unique,
  authorization_url text,
  -- Renewals: the period this invoice pays for.
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  failure_reason text,
  provider_response jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index billing_invoices_business_idx on public.billing_invoices (business_id, created_at desc);
create unique index billing_invoices_one_renewal_per_period on public.billing_invoices (subscription_id, period_start) where kind = 'renewal' and status <> 'void';

create trigger billing_invoices_updated_at before update on public.billing_invoices
  for each row execute function private.set_updated_at();
create trigger billing_invoices_business_immutable before update of business_id on public.billing_invoices
  for each row execute function private.forbid_business_id_change();

alter table public.billing_invoices enable row level security;
create policy billing_invoices_select on public.billing_invoices for select to authenticated
  using ((select private.has_perm(business_id, 'billing.manage')));
revoke insert, update, delete on public.billing_invoices from authenticated, anon;

create or replace function private.plan_interval(p_interval text)
returns interval
language sql
immutable
as $$ select case when p_interval = 'annually' then interval '1 year' else interval '1 month' end $$;

-- -----------------------------------------------------------------------------
-- Applies a verified payment to its invoice and the subscription, atomically
-- and idempotently. p_card: {"brand","last4","exp"} from a reusable card, or null.
-- Returns {outcome: applied | already_paid | void_paid, kind, plan_code, ...}.
-- -----------------------------------------------------------------------------
create or replace function public.apply_billing_payment(
  p_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_paid_at timestamptz,
  p_card jsonb default null,
  p_provider_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.billing_invoices%rowtype;
  v_sub public.subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
begin
  select * into v_inv from public.billing_invoices where reference = p_reference for update;
  if not found then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if v_inv.status = 'paid' then
    return jsonb_build_object('outcome', 'already_paid', 'kind', v_inv.kind, 'business_id', v_inv.business_id);
  end if;
  if p_amount_minor <> v_inv.amount_minor or upper(p_currency) <> v_inv.currency then
    raise exception 'amount mismatch: expected % %, got % %', v_inv.amount_minor, v_inv.currency, p_amount_minor, upper(p_currency) using errcode = '22023';
  end if;

  update public.billing_invoices
     set status = 'paid', paid_at = v_paid_at, failure_reason = null, provider_response = coalesce(p_provider_response, '{}'::jsonb)
   where id = v_inv.id;

  select * into v_sub from public.subscriptions where id = v_inv.subscription_id for update;
  select * into v_plan from public.subscription_plans where id = v_inv.plan_id;

  if p_card is not null and p_card ->> 'last4' is not null then
    update public.subscriptions
       set card_brand = left(p_card ->> 'brand', 30), card_last4 = left(p_card ->> 'last4', 4), card_exp = left(p_card ->> 'exp', 7)
     where id = v_sub.id;
  end if;

  -- Paid for a checkout that was superseded (e.g. two tabs): keep the money on
  -- record for the team to refund or credit; don't change the plan twice.
  if v_inv.status = 'void' then
    insert into public.billing_events (business_id, subscription_id, type, amount_minor, payload)
    values (v_inv.business_id, v_sub.id, 'invoice.paid_after_void', p_amount_minor, jsonb_build_object('invoice_id', v_inv.id, 'reference', p_reference));
    return jsonb_build_object('outcome', 'void_paid', 'kind', v_inv.kind, 'business_id', v_inv.business_id);
  end if;

  if v_inv.kind = 'subscribe' then
    update public.subscriptions
       set plan_id = v_plan.id, status = 'active', current_period_start = v_paid_at,
           current_period_end = v_paid_at + private.plan_interval(v_plan.interval),
           cancel_at_period_end = false, cancelled_at = null, pending_plan_id = null,
           past_due_since = null, renewal_attempts = 0, next_renewal_attempt_at = null
     where id = v_sub.id;
  elsif v_inv.kind = 'upgrade' then
    update public.subscriptions
       set plan_id = v_plan.id, pending_plan_id = null, cancel_at_period_end = false
     where id = v_sub.id;
  else -- renewal
    update public.subscriptions
       set plan_id = v_plan.id, status = 'active', current_period_start = v_inv.period_start, current_period_end = v_inv.period_end,
           pending_plan_id = null, past_due_since = null, renewal_attempts = 0, next_renewal_attempt_at = null
     where id = v_sub.id;
  end if;

  -- Any other open checkout for this subscription is now stale.
  update public.billing_invoices set status = 'void', failure_reason = 'superseded'
   where subscription_id = v_sub.id and status = 'pending' and id <> v_inv.id and kind <> 'renewal';

  insert into public.billing_events (business_id, subscription_id, type, provider_event_key, amount_minor, payload)
  values (v_inv.business_id, v_sub.id, 'invoice.paid', 'invoice:' || v_inv.id, p_amount_minor,
          jsonb_build_object('invoice_id', v_inv.id, 'kind', v_inv.kind, 'plan', v_plan.code, 'reference', p_reference));
  insert into public.audit_logs (business_id, actor_type, action, entity_type, entity_id, metadata)
  values (v_inv.business_id, 'system', 'billing.invoice_paid', 'billing_invoice', v_inv.id,
          jsonb_build_object('kind', v_inv.kind, 'plan', v_plan.code, 'amount_minor', p_amount_minor));

  return jsonb_build_object('outcome', 'applied', 'kind', v_inv.kind, 'plan_code', v_plan.code, 'plan_name', v_plan.name,
                            'business_id', v_inv.business_id, 'invoice_id', v_inv.id);
end;
$$;

-- A renewal charge failed: past_due (grace period starts), next retry scheduled.
create or replace function public.mark_renewal_failed(p_invoice_id uuid, p_reason text, p_next_attempt timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.billing_invoices%rowtype;
begin
  select * into v_inv from public.billing_invoices where id = p_invoice_id for update;
  if not found or v_inv.status = 'paid' then return; end if;
  update public.billing_invoices set failure_reason = left(p_reason, 500) where id = v_inv.id;
  update public.subscriptions
     set status = case when status in ('active', 'past_due') then 'past_due'::public.subscription_status else status end,
         past_due_since = coalesce(past_due_since, now()),
         renewal_attempts = renewal_attempts + 1,
         next_renewal_attempt_at = p_next_attempt
   where id = v_inv.subscription_id;
  insert into public.billing_events (business_id, subscription_id, type, amount_minor, payload)
  values (v_inv.business_id, v_inv.subscription_id, 'renewal.failed', v_inv.amount_minor, jsonb_build_object('invoice_id', v_inv.id, 'reason', left(p_reason, 500)));
end;
$$;

-- Time-based transitions (hourly job). Returns counts.
create or replace function public.advance_subscription_states(p_grace interval default interval '3 days')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial integer; v_cancelled integer; v_expired integer;
begin
  update public.subscriptions set status = 'expired'
   where status = 'trialing' and coalesce(trial_ends_at, current_period_end) <= now();
  get diagnostics v_trial = row_count;

  update public.subscriptions set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now())
   where status in ('active', 'past_due') and cancel_at_period_end and current_period_end <= now();
  get diagnostics v_cancelled = row_count;

  update public.subscriptions set status = 'expired'
   where (status = 'past_due' and past_due_since <= now() - p_grace)
      or (status = 'active' and current_period_end <= now() - p_grace);
  get diagnostics v_expired = row_count;

  -- Renewal invoices for periods that are over can no longer be paid.
  update public.billing_invoices i set status = 'void', failure_reason = coalesce(i.failure_reason, 'subscription ended')
    from public.subscriptions s
   where i.subscription_id = s.id and i.status = 'pending' and i.kind = 'renewal' and s.status in ('expired', 'cancelled');

  return jsonb_build_object('trials_expired', v_trial, 'cancelled', v_cancelled, 'expired', v_expired);
end;
$$;

-- Plan-change requests from the dashboard (the caller's permission is checked
-- in the app; these only touch scheduling fields).
create or replace function public.set_subscription_schedule(p_business_id uuid, p_cancel_at_period_end boolean, p_pending_plan_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan uuid;
begin
  if p_pending_plan_code is not null then
    select id into v_plan from public.subscription_plans where code = p_pending_plan_code and is_active;
    if v_plan is null then raise exception 'unknown plan' using errcode = '22023'; end if;
  end if;
  update public.subscriptions
     set cancel_at_period_end = p_cancel_at_period_end, pending_plan_id = v_plan
   where business_id = p_business_id and status in ('active', 'past_due');
  if not found then raise exception 'no active subscription' using errcode = 'P0002'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- A subscription in its grace period (past_due) keeps working.
-- -----------------------------------------------------------------------------
create or replace function public.follow_up_stop_reason(p_conversation_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c record;
begin
  select conv.status, conv.ai_mode, conv.sales_outcome, conv.whatsapp_account_id,
         cu.opted_out_at, b.status as business_status,
         s.follow_up_enabled, s.follow_up_max,
         sub.status as sub_status, coalesce((pl.features ->> 'follow_ups')::boolean, false) as plan_allows
    into c
    from public.conversations conv
    join public.customers cu on cu.id = conv.customer_id
    join public.businesses b on b.id = conv.business_id
    left join public.ai_settings s on s.business_id = conv.business_id
    left join public.subscriptions sub on sub.business_id = conv.business_id
    left join public.subscription_plans pl on pl.id = sub.plan_id
   where conv.id = p_conversation_id;

  if not found then return 'not_found'; end if;
  if c.business_status <> 'active' then return 'business_inactive'; end if;
  if not coalesce(c.follow_up_enabled, false) then return 'automation_disabled'; end if;
  if c.sub_status is null or c.sub_status not in ('active', 'trialing', 'past_due') or not c.plan_allows then return 'plan'; end if;
  if c.sales_outcome = 'purchased' then return 'purchased'; end if;
  if c.sales_outcome <> 'interested_not_purchased' then return 'no_purchase_intent'; end if;
  if c.opted_out_at is not null then return 'opted_out'; end if;
  if c.status <> 'open' then return 'conversation_closed'; end if;
  if c.ai_mode <> 'AI_ACTIVE' then return 'human_handling'; end if;
  if c.whatsapp_account_id is null then return 'no_whatsapp_number'; end if;
  if private.follow_ups_sent_in_episode(p_conversation_id) >= coalesce(c.follow_up_max, 0) then return 'max_reached'; end if;
  return null;
end;
$$;

revoke execute on function public.apply_billing_payment(text, bigint, text, timestamptz, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.mark_renewal_failed(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.advance_subscription_states(interval) from public, anon, authenticated;
revoke execute on function public.set_subscription_schedule(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function private.plan_interval(text) from public, anon, authenticated;
grant execute on function public.apply_billing_payment(text, bigint, text, timestamptz, jsonb, jsonb) to service_role;
grant execute on function public.mark_renewal_failed(uuid, text, timestamptz) to service_role;
grant execute on function public.advance_subscription_states(interval) to service_role;
grant execute on function public.set_subscription_schedule(uuid, boolean, text) to service_role;
