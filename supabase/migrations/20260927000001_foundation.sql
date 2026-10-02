-- =============================================================================
-- SellFlow foundation: extensions, private helpers, identity & tenancy.
--
-- Tenancy model: every tenant-owned row carries `business_id`. Access for
-- dashboard users is enforced by RLS through `private.is_member()` /
-- `private.has_perm()`. Webhooks and background jobs use the service role and
-- MUST resolve business_id from trusted data (e.g. phone_number_id), never
-- from user input.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.business_status as enum ('active', 'suspended', 'closed');
create type public.member_role as enum ('owner', 'admin', 'staff');
create type public.member_status as enum ('active', 'invited', 'disabled');

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles ("users"): 1:1 with auth.users
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email extensions.citext not null,
  full_name text,
  avatar_url text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Users must never be able to promote themselves to platform admin.
create or replace function private.protect_profile_admin_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'is_platform_admin can only be changed by the platform';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_admin before update on public.profiles
  for each row execute function private.protect_profile_admin_flag();

-- -----------------------------------------------------------------------------
-- businesses (tenants)
-- -----------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  description text,
  industry text,
  country char(2) not null default 'NG',
  currency char(3) not null default 'NGN',
  timezone text not null default 'Africa/Lagos',
  phone text,
  address text,
  website text,
  social_links jsonb not null default '{}'::jsonb,
  logo_path text,
  status public.business_status not null default 'active',
  suspended_reason text,
  onboarding_step text not null default 'business',
  onboarding_completed_at timestamptz,
  order_seq bigint not null default 1000,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index businesses_created_at_idx on public.businesses (created_at desc);
create index businesses_status_idx on public.businesses (status);

create trigger businesses_updated_at before update on public.businesses
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- permissions (catalog) + business_members (roles)
-- Roles: owner/admin implicitly hold every permission; staff hold an explicit
-- list from this catalog.
-- -----------------------------------------------------------------------------
create table public.permissions (
  key text primary key,
  description text not null
);

insert into public.permissions (key, description) values
  ('conversations.view',  'View conversations and messages'),
  ('conversations.reply', 'Reply to customers, pause/resume AI, assign conversations'),
  ('customers.view',      'View customer profiles'),
  ('customers.manage',    'Edit customers, tags and notes'),
  ('orders.view',         'View orders and payments'),
  ('orders.manage',       'Create, update and cancel orders'),
  ('products.manage',     'Create, edit, import and archive products'),
  ('analytics.view',      'View analytics and reports'),
  ('campaigns.manage',    'Create and send campaigns, configure follow-ups'),
  ('settings.manage',     'Manage business profile, WhatsApp, Paystack and AI settings'),
  ('staff.manage',        'Invite and manage staff'),
  ('billing.manage',      'Manage subscription and billing');

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'staff',
  permissions text[] not null default '{}',
  status public.member_status not null default 'active',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index business_members_user_idx on public.business_members (user_id, business_id) where status = 'active';

create trigger business_members_updated_at before update on public.business_members
  for each row execute function private.set_updated_at();

create table public.business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  email extensions.citext not null,
  role public.member_role not null default 'staff' check (role <> 'owner'),
  permissions text[] not null default '{}',
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index business_invitations_business_idx on public.business_invitations (business_id);
create unique index business_invitations_pending_uniq
  on public.business_invitations (business_id, email) where accepted_at is null;

-- -----------------------------------------------------------------------------
-- Authorization helpers (used by RLS). SECURITY DEFINER so they can read
-- business_members without recursive RLS; they always scope to auth.uid().
-- -----------------------------------------------------------------------------
create or replace function private.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

create or replace function private.has_perm(p_business_id uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (m.role in ('owner', 'admin') or p_perm = any (m.permissions))
  );
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

revoke execute on function private.is_member(uuid) from public, anon;
revoke execute on function private.has_perm(uuid, text) from public, anon;
revoke execute on function private.is_platform_admin() from public, anon;
grant execute on function private.is_member(uuid) to authenticated, service_role;
grant execute on function private.has_perm(uuid, text) to authenticated, service_role;
grant execute on function private.is_platform_admin() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Encrypted third-party credentials (WhatsApp tokens, Paystack keys).
-- Ciphertext is produced in the application (AES-256-GCM, CREDENTIALS_ENCRYPTION_KEY).
-- No RLS policies => only the service role can read/write.
-- -----------------------------------------------------------------------------
create table public.business_credentials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null check (provider in ('whatsapp', 'paystack')),
  label text not null default 'default',
  ciphertext text not null,
  key_version smallint not null default 1,
  last_four text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, provider, label)
);

create trigger business_credentials_updated_at before update on public.business_credentials
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Audit logs, notifications, platform settings
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'ai', 'system', 'webhook', 'admin')),
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index audit_logs_business_created_idx on public.audit_logs (business_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_business_created_idx on public.notifications (business_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
