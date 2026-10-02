-- =============================================================================
-- AI agent configuration, AI audit trail, follow-ups and campaigns.
-- =============================================================================

create type public.follow_up_status as enum ('scheduled', 'sent', 'cancelled', 'failed', 'skipped');
create type public.campaign_status as enum ('draft', 'scheduled', 'sending', 'completed', 'cancelled', 'failed');
create type public.campaign_recipient_status as enum ('pending', 'sent', 'delivered', 'read', 'failed', 'skipped');

-- One agent per business (identity, model, on/off).
create table public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  name text not null default 'Sales Assistant',
  enabled boolean not null default false,
  model text not null default 'anthropic/claude-sonnet-5',
  tone text not null default 'friendly' check (tone in ('friendly', 'professional', 'playful', 'concise')),
  greeting text,
  language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ai_agents_updated_at before update on public.ai_agents
  for each row execute function private.set_updated_at();

-- Business policies the agent may quote. Structured where the AI must not
-- invent values (delivery fees, hours, discounts).
create table public.ai_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  return_policy text,
  delivery_policy text,
  delivery_zones jsonb not null default '[]'::jsonb,   -- [{"name":"Lagos Mainland","fee_minor":300000,"eta":"1-2 days"}]
  business_hours jsonb not null default '{}'::jsonb,   -- {"mon":[["09:00","18:00"]], ...}
  discount_rules text,
  max_discount_percent numeric(5,2) not null default 0 check (max_discount_percent between 0 and 100),
  escalation_rules text,
  payment_rules text,
  -- abandoned-lead recovery
  follow_up_enabled boolean not null default false,
  follow_up_delay_minutes integer not null default 240 check (follow_up_delay_minutes between 15 and 10080),
  follow_up_max integer not null default 2 check (follow_up_max between 0 and 5),
  follow_up_message text,
  follow_up_respect_hours boolean not null default true,
  follow_up_template_name text,       -- approved Meta template for outside the 24h window
  attribution_window_hours integer not null default 72 check (attribution_window_hours between 1 and 720),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ai_settings_updated_at before update on public.ai_settings
  for each row execute function private.set_updated_at();

-- Every tool call the AI makes (auditable, debuggable).
create table public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  ai_request_id text not null,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status text not null default 'ok' check (status in ('ok', 'error', 'denied')),
  error text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index ai_actions_conversation_idx on public.ai_actions (conversation_id, created_at desc);
create index ai_actions_business_idx on public.ai_actions (business_id, created_at desc);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  ai_request_id text not null unique,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_micro_usd bigint,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index ai_usage_business_created_idx on public.ai_usage (business_id, created_at desc);

-- -----------------------------------------------------------------------------
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  sequence_number integer not null default 1,
  scheduled_for timestamptz not null,
  status public.follow_up_status not null default 'scheduled',
  message text,
  message_id uuid references public.messages (id) on delete set null,
  cancel_reason text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, sequence_number)
);

create index follow_ups_due_idx on public.follow_ups (scheduled_for) where status = 'scheduled';
create index follow_ups_business_idx on public.follow_ups (business_id, created_at desc);
create index follow_ups_customer_sent_idx on public.follow_ups (customer_id, sent_at desc) where status = 'sent';

create trigger follow_ups_updated_at before update on public.follow_ups
  for each row execute function private.set_updated_at();
create trigger follow_ups_tenant before insert or update of conversation_id, business_id on public.follow_ups
  for each row execute function private.enforce_conversation_tenant();

alter table public.orders
  add constraint orders_recovered_by_follow_up_fk
  foreign key (recovered_by_follow_up_id) references public.follow_ups (id) on delete set null;

-- -----------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  status public.campaign_status not null default 'draft',
  segment jsonb not null default '{"type":"all"}'::jsonb,
  product_id uuid references public.products (id) on delete set null,
  template_name text,           -- approved Meta template (required for marketing outside 24h window)
  template_language text default 'en',
  template_params jsonb not null default '[]'::jsonb,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_business_idx on public.campaigns (business_id, created_at desc);
create index campaigns_scheduled_idx on public.campaigns (scheduled_at) where status = 'scheduled';

create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function private.set_updated_at();

alter table public.orders
  add constraint orders_campaign_fk
  foreign key (campaign_id) references public.campaigns (id) on delete set null;

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  status public.campaign_recipient_status not null default 'pending',
  wa_message_id text,
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  converted_order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (campaign_id, customer_id)
);

create index campaign_recipients_campaign_status_idx on public.campaign_recipients (campaign_id, status);
create index campaign_recipients_business_idx on public.campaign_recipients (business_id);
create trigger campaign_recipients_tenant before insert or update of customer_id, business_id on public.campaign_recipients
  for each row execute function private.enforce_customer_tenant();
