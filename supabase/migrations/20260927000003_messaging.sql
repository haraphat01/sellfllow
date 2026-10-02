-- =============================================================================
-- WhatsApp accounts, inbound events, customers, conversations, messages.
--
-- Critical tenant mapping:  phone_number_id -> whatsapp_accounts -> business_id
-- =============================================================================

create type public.whatsapp_account_status as enum ('pending', 'connected', 'disconnected', 'error');
create type public.customer_status as enum ('lead', 'interested', 'customer', 'repeat_customer', 'inactive');
create type public.conversation_status as enum ('open', 'closed');
create type public.ai_mode as enum ('AI_ACTIVE', 'HUMAN_ACTIVE', 'PAUSED');
create type public.purchase_stage as enum (
  'new', 'product_discovery', 'product_question', 'purchase_intent',
  'collecting_customer_details', 'order_confirmation', 'payment_pending',
  'paid', 'delivery', 'completed', 'human_handoff'
);
create type public.sales_outcome as enum ('none', 'interested_not_purchased', 'purchased', 'lost');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_sender as enum ('customer', 'ai', 'staff', 'system', 'automation');
create type public.message_status as enum ('received', 'queued', 'sent', 'delivered', 'read', 'failed');
create type public.event_status as enum ('received', 'processing', 'processed', 'ignored', 'failed');

-- -----------------------------------------------------------------------------
create table public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null unique, -- globally unique: this IS the tenant router
  display_phone_number text,
  verified_name text,
  meta_business_id text,
  status public.whatsapp_account_status not null default 'pending',
  quality_rating text,
  credential_id uuid references public.business_credentials (id) on delete set null,
  last_error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index whatsapp_accounts_business_idx on public.whatsapp_accounts (business_id);

create trigger whatsapp_accounts_updated_at before update on public.whatsapp_accounts
  for each row execute function private.set_updated_at();

-- Raw inbound Meta webhook events. `event_key` is the idempotency key
-- (message id / status id + status). Duplicate deliveries hit the unique index.
create table public.whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  business_id uuid references public.businesses (id) on delete cascade,
  whatsapp_account_id uuid references public.whatsapp_accounts (id) on delete set null,
  phone_number_id text,
  event_type text not null, -- message | status | unknown
  payload jsonb not null,
  status public.event_status not null default 'received',
  attempts integer not null default 0,
  error text,
  request_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index whatsapp_events_business_idx on public.whatsapp_events (business_id, received_at desc);
create index whatsapp_events_status_idx on public.whatsapp_events (status, received_at) where status in ('received', 'failed');

-- -----------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  wa_id text not null,          -- WhatsApp id (E.164 digits without +)
  phone text not null,
  name text,
  profile_name text,            -- name reported by WhatsApp
  email extensions.citext,
  address jsonb,
  status public.customer_status not null default 'lead',
  total_orders integer not null default 0,
  total_spend_minor bigint not null default 0,
  last_interaction_at timestamptz,
  last_purchase_at timestamptz,
  marketing_opt_in boolean not null default false,
  opted_out_at timestamptz,     -- customer asked to stop automated messages
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, wa_id)
);

create index customers_business_phone_idx on public.customers (business_id, phone);
create index customers_business_status_idx on public.customers (business_id, status);
create index customers_business_last_interaction_idx on public.customers (business_id, last_interaction_at desc);

create trigger customers_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

create table public.customer_tags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  tag text not null check (char_length(tag) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (customer_id, tag)
);

create index customer_tags_business_tag_idx on public.customer_tags (business_id, tag);

-- -----------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  whatsapp_account_id uuid references public.whatsapp_accounts (id) on delete set null,
  status public.conversation_status not null default 'open',
  ai_mode public.ai_mode not null default 'AI_ACTIVE',
  purchase_stage public.purchase_stage not null default 'new',
  sales_outcome public.sales_outcome not null default 'none',
  state jsonb not null default '{}'::jsonb, -- structured AI conversation state
  summary text,                             -- rolling summary for AI context
  assigned_to uuid references auth.users (id) on delete set null,
  needs_attention boolean not null default false,
  unread_count integer not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  last_customer_message_at timestamptz,     -- drives the 24h customer-service window
  purchase_intent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open conversation per customer per WhatsApp number.
create unique index conversations_open_uniq
  on public.conversations (customer_id, whatsapp_account_id) where status = 'open';
create index conversations_business_last_msg_idx on public.conversations (business_id, last_message_at desc);
create index conversations_business_status_idx on public.conversations (business_id, status, ai_mode);
create index conversations_followup_idx on public.conversations (business_id, sales_outcome, last_customer_message_at)
  where sales_outcome = 'interested_not_purchased';

create trigger conversations_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction public.message_direction not null,
  sender public.message_sender not null,
  sender_user_id uuid references auth.users (id) on delete set null,
  type text not null default 'text', -- text | image | template | interactive | ...
  body text,
  content jsonb not null default '{}'::jsonb,
  wa_message_id text,
  status public.message_status not null,
  error text,
  ai_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index messages_wa_message_id_uniq on public.messages (wa_message_id) where wa_message_id is not null;
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index messages_business_created_idx on public.messages (business_id, created_at desc);

create trigger messages_updated_at before update on public.messages
  for each row execute function private.set_updated_at();

create table public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  type text not null, -- note | ai_paused | ai_resumed | human_takeover | assigned | stage_changed | handoff_requested | ...
  actor_type text not null default 'user' check (actor_type in ('user', 'ai', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index conversation_events_conversation_idx on public.conversation_events (conversation_id, created_at desc);
create index conversation_events_business_idx on public.conversation_events (business_id, created_at desc);

-- Keep children in the same tenant as their conversation / customer.
create or replace function private.enforce_conversation_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = new.conversation_id and c.business_id = new.business_id
  ) then
    raise exception 'conversation % does not belong to business %', new.conversation_id, new.business_id;
  end if;
  return new;
end;
$$;

create or replace function private.enforce_customer_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.business_id = new.business_id
  ) then
    raise exception 'customer % does not belong to business %', new.customer_id, new.business_id;
  end if;
  return new;
end;
$$;

create trigger messages_tenant before insert or update of conversation_id, business_id on public.messages
  for each row execute function private.enforce_conversation_tenant();
create trigger conversation_events_tenant before insert or update of conversation_id, business_id on public.conversation_events
  for each row execute function private.enforce_conversation_tenant();
create trigger conversations_customer_tenant before insert or update of customer_id, business_id on public.conversations
  for each row execute function private.enforce_customer_tenant();
create trigger customer_tags_tenant before insert or update of customer_id, business_id on public.customer_tags
  for each row execute function private.enforce_customer_tenant();
