-- =============================================================================
-- Subscriptions, plan limits, usage metering. Prices/limits are data (editable
-- from /admin), not code.
-- =============================================================================

create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled', 'expired');

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  description text,
  price_minor bigint not null check (price_minor >= 0),
  currency char(3) not null default 'NGN',
  interval text not null default 'monthly' check (interval in ('monthly', 'annually')),
  -- Numeric limits; null = unlimited. Keys: monthly_ai_conversations, messages,
  -- customers, orders, campaigns, whatsapp_numbers, staff, products
  limits jsonb not null default '{}'::jsonb,
  -- Boolean feature flags. Keys: follow_ups, campaigns, advanced_analytics, api, priority_support
  features jsonb not null default '{}'::jsonb,
  paystack_plan_code text,
  is_active boolean not null default true,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger subscription_plans_updated_at before update on public.subscription_plans
  for each row execute function private.set_updated_at();

insert into public.subscription_plans (code, name, description, price_minor, limits, features, sort_order) values
  ('starter', 'Starter', 'For businesses getting started with WhatsApp sales automation.', 990000,
   '{"monthly_ai_conversations":300,"messages":3000,"customers":1000,"orders":300,"campaigns":0,"whatsapp_numbers":1,"staff":1,"products":100}',
   '{"follow_ups":false,"campaigns":false,"advanced_analytics":false,"api":false,"priority_support":false}', 1),
  ('growth', 'Growth', 'Recover lost sales with automated follow-ups and campaigns.', 2490000,
   '{"monthly_ai_conversations":1500,"messages":15000,"customers":10000,"orders":2000,"campaigns":10,"whatsapp_numbers":1,"staff":5,"products":1000}',
   '{"follow_ups":true,"campaigns":true,"advanced_analytics":true,"api":false,"priority_support":false}', 2),
  ('pro', 'Pro', 'High volume, multiple numbers, API access and priority support.', 5990000,
   '{"monthly_ai_conversations":6000,"messages":60000,"customers":null,"orders":null,"campaigns":50,"whatsapp_numbers":3,"staff":20,"products":null}',
   '{"follow_ups":true,"campaigns":true,"advanced_analytics":true,"api":true,"priority_support":true}', 3);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  plan_id uuid not null references public.subscription_plans (id),
  status public.subscription_status not null default 'trialing',
  trial_ends_at timestamptz,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null default now() + interval '14 days',
  cancel_at_period_end boolean not null default false,
  paystack_customer_code text,
  paystack_subscription_code text,
  paystack_email_token text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_status_idx on public.subscriptions (status, current_period_end);
create index subscriptions_plan_idx on public.subscriptions (plan_id);

create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();

-- Monthly counters per metric.
create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  metric text not null,
  period_start date not null,
  quantity bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (business_id, metric, period_start)
);

-- Dedupe for "count once per subject per period" metrics (e.g. AI conversations).
create table private.usage_subjects (
  business_id uuid not null,
  metric text not null,
  period_start date not null,
  subject_id text not null,
  primary key (business_id, metric, period_start, subject_id)
);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  type text not null,
  provider_event_key text unique,
  amount_minor bigint,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index billing_events_business_idx on public.billing_events (business_id, created_at desc);

-- Atomically increment a usage counter. When p_subject_id is given, the
-- increment happens at most once per (metric, period, subject).
-- Returns the counter value after the call. Service role only.
create or replace function public.record_usage(
  p_business_id uuid,
  p_metric text,
  p_quantity bigint default 1,
  p_subject_id text default null,
  p_at timestamptz default now()
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', p_at at time zone 'UTC')::date;
  v_inserted integer;
  v_total bigint;
begin
  if p_subject_id is not null then
    insert into private.usage_subjects (business_id, metric, period_start, subject_id)
    values (p_business_id, p_metric, v_period, p_subject_id)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      select quantity into v_total from public.usage_records
       where business_id = p_business_id and metric = p_metric and period_start = v_period;
      return coalesce(v_total, 0);
    end if;
  end if;

  insert into public.usage_records (business_id, metric, period_start, quantity)
  values (p_business_id, p_metric, v_period, p_quantity)
  on conflict (business_id, metric, period_start)
  do update set quantity = public.usage_records.quantity + excluded.quantity, updated_at = now()
  returning quantity into v_total;

  return v_total;
end;
$$;

revoke execute on function public.record_usage(uuid, text, bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_usage(uuid, text, bigint, text, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- create_business: the only way a user creates a tenant. Creates the business,
-- makes the caller its owner, provisions default AI config and a trial.
-- -----------------------------------------------------------------------------
create or replace function public.create_business(
  p_name text,
  p_industry text default null,
  p_country char(2) default 'NG',
  p_currency char(3) default 'NGN',
  p_timezone text default 'Africa/Lagos'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_business_id uuid;
  v_slug text;
  v_plan_id uuid;
  v_trial_days integer := 14;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if char_length(coalesce(trim(p_name), '')) < 2 then
    raise exception 'business name is required' using errcode = '22023';
  end if;

  -- Soft cap on how many businesses one user can create (abuse guard).
  if (select count(*) from public.business_members where user_id = v_user and role = 'owner') >= 5 then
    raise exception 'business limit reached' using errcode = '54000';
  end if;

  v_slug := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 48);
  if char_length(v_slug) < 2 then
    v_slug := 'biz';
  end if;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.businesses (name, slug, industry, country, currency, timezone, created_by)
  values (trim(p_name), v_slug, p_industry, upper(p_country), upper(p_currency), p_timezone, v_user)
  returning id into v_business_id;

  insert into public.business_members (business_id, user_id, role, status)
  values (v_business_id, v_user, 'owner', 'active');

  insert into public.ai_agents (business_id) values (v_business_id);
  insert into public.ai_settings (business_id) values (v_business_id);

  select id into v_plan_id from public.subscription_plans where code = 'starter';
  select coalesce((value ->> 'trial_days')::integer, 14) into v_trial_days
    from public.platform_settings where key = 'billing';
  v_trial_days := coalesce(v_trial_days, 14);

  insert into public.subscriptions (business_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
  values (v_business_id, v_plan_id, 'trialing', now() + make_interval(days => v_trial_days), now(), now() + make_interval(days => v_trial_days));

  insert into public.audit_logs (business_id, actor_user_id, action, entity_type, entity_id)
  values (v_business_id, v_user, 'business.created', 'business', v_business_id);

  return v_business_id;
end;
$$;

revoke execute on function public.create_business(text, text, char, char, text) from public, anon;
grant execute on function public.create_business(text, text, char, char, text) to authenticated;
