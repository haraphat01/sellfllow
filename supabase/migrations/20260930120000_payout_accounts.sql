-- =============================================================================
-- Bank-account payouts for merchants without a Paystack account.
--
-- The merchant's bank account becomes a Paystack *subaccount* of SellFlow's
-- platform account. Customer payments are initialised with the platform key
-- and split to the subaccount, so Paystack settles directly to the merchant's
-- bank — SellFlow never holds merchant funds. A merchant's own Paystack key,
-- when connected, always takes precedence.
-- =============================================================================

create table public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  provider text not null default 'paystack' check (provider = 'paystack'),
  bank_code text not null,
  bank_name text not null,
  account_number_last4 text not null check (account_number_last4 ~ '^[0-9]{4}$'),
  account_name text not null,                 -- as returned by Paystack's account lookup
  subaccount_code text not null unique,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payout_accounts_updated_at before update on public.payout_accounts
  for each row execute function private.set_updated_at();
create trigger payout_accounts_business_immutable before update of business_id on public.payout_accounts
  for each row execute function private.forbid_business_id_change();

alter table public.payout_accounts enable row level security;
create policy payout_accounts_select on public.payout_accounts for select to authenticated
  using ((select private.has_perm(business_id, 'settings.manage')));
revoke insert, update, delete on public.payout_accounts from authenticated, anon;

-- How each payment is collected (decides which key verifies/refunds it).
alter table public.payments
  add column if not exists collection_mode text not null default 'merchant_key' check (collection_mode in ('merchant_key', 'platform_subaccount')),
  add column if not exists subaccount_code text,
  add column if not exists platform_fee_minor bigint not null default 0 check (platform_fee_minor >= 0);

alter table public.payments
  add constraint payments_subaccount_consistent check (
    (collection_mode = 'merchant_key' and subaccount_code is null and platform_fee_minor = 0)
    or (collection_mode = 'platform_subaccount' and subaccount_code is not null)
  );
