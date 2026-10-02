-- =============================================================================
-- Orders & payments.
--
-- Payment truth rule: an order can only become `paid` from the service role
-- (Paystack webhook / server-side verification). Dashboard users - and
-- therefore anything the browser can reach - cannot mark an order paid.
-- =============================================================================

create type public.order_status as enum (
  'draft', 'pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'
);
create type public.order_source as enum ('ai', 'staff', 'campaign');
create type public.payment_status as enum ('initialized', 'pending', 'success', 'failed', 'abandoned', 'reversed', 'refunded');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_number bigint not null,
  customer_id uuid not null references public.customers (id) on delete restrict,
  conversation_id uuid references public.conversations (id) on delete set null,
  status public.order_status not null default 'pending_payment',
  source public.order_source not null default 'ai',
  currency char(3) not null default 'NGN',
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  delivery_fee_minor bigint not null default 0 check (delivery_fee_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  customer_name text not null,
  customer_phone text not null,
  delivery_address jsonb not null default '{}'::jsonb,
  notes text,
  -- Attribution (see AI.md / analytics): set by the server, never by the UI.
  ai_assisted boolean not null default false,
  recovered_by_follow_up_id uuid,
  campaign_id uuid,
  idempotency_key text,
  confirmed_by_customer_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, order_number),
  constraint orders_total_consistent check (total_minor = subtotal_minor + delivery_fee_minor - discount_minor)
);

create unique index orders_idempotency_uniq on public.orders (business_id, idempotency_key) where idempotency_key is not null;
create index orders_business_status_idx on public.orders (business_id, status, created_at desc);
create index orders_business_created_idx on public.orders (business_id, created_at desc);
create index orders_customer_idx on public.orders (customer_id);
create index orders_conversation_idx on public.orders (conversation_id);

create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();
create trigger orders_customer_tenant before insert or update of customer_id, business_id on public.orders
  for each row execute function private.enforce_customer_tenant();

-- Per-business, gap-tolerant human-friendly order numbers.
create or replace function private.assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_number is null then
    update public.businesses
       set order_seq = order_seq + 1
     where id = new.business_id
    returning order_seq into new.order_number;
  end if;
  return new;
end;
$$;

create trigger orders_assign_number before insert on public.orders
  for each row execute function private.assign_order_number();

-- Only the service role may move an order into/out of payment-verified states
-- or change money fields after creation.
create or replace function private.guard_order_payment_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_service boolean := coalesce(auth.role(), '') = 'service_role'
                        or current_user in ('postgres', 'supabase_admin', 'service_role');
begin
  if is_service then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending_payment') or new.paid_at is not null then
      raise exception 'orders can only be created as draft or pending_payment';
    end if;
    if new.source <> 'staff' or new.ai_assisted or new.recovered_by_follow_up_id is not null or new.campaign_id is not null then
      raise exception 'attribution fields are set by the server only';
    end if;
    return new;
  end if;

  if (new.status in ('paid', 'refunded') and new.status is distinct from old.status)
     or new.paid_at is distinct from old.paid_at
     or new.total_minor is distinct from old.total_minor
     or new.subtotal_minor is distinct from old.subtotal_minor
     or new.ai_assisted is distinct from old.ai_assisted
     or new.recovered_by_follow_up_id is distinct from old.recovered_by_follow_up_id then
    raise exception 'payment state and totals can only be changed by verified payment processing';
  end if;

  -- Fulfilment states require the order to have been paid first.
  if new.status in ('processing', 'shipped', 'delivered') and old.paid_at is null then
    raise exception 'order must be paid before fulfilment';
  end if;

  return new;
end;
$$;

create trigger orders_guard_payment before insert or update on public.orders
  for each row execute function private.guard_order_payment_state();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  name text not null,           -- snapshot at purchase time
  variant_label text,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity > 0),
  total_minor bigint not null check (total_minor >= 0),
  created_at timestamptz not null default now(),
  constraint order_items_total_consistent check (total_minor = unit_price_minor * quantity)
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_business_product_idx on public.order_items (business_id, product_id);

create or replace function private.enforce_order_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.orders o
    where o.id = new.order_id and o.business_id = new.business_id
  ) then
    raise exception 'order % does not belong to business %', new.order_id, new.business_id;
  end if;
  return new;
end;
$$;

create trigger order_items_tenant before insert or update on public.order_items
  for each row execute function private.enforce_order_tenant();

-- -----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null default 'paystack',
  reference text not null unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status public.payment_status not null default 'initialized',
  authorization_url text,
  access_code text,
  channel text,
  provider_transaction_id text,
  provider_response jsonb not null default '{}'::jsonb,
  failure_reason text,
  verified_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_idx on public.payments (order_id);
create index payments_business_status_idx on public.payments (business_id, status, created_at desc);

create trigger payments_updated_at before update on public.payments
  for each row execute function private.set_updated_at();
create trigger payments_tenant before insert or update on public.payments
  for each row execute function private.enforce_order_tenant();

-- Paystack webhook idempotency.
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paystack',
  event_key text not null,
  event_type text not null,
  business_id uuid references public.businesses (id) on delete cascade,
  payment_id uuid references public.payments (id) on delete set null,
  payload jsonb not null,
  status public.event_status not null default 'received',
  error text,
  request_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_key)
);

create index payment_events_business_idx on public.payment_events (business_id, received_at desc);
