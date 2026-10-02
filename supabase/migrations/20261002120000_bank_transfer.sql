-- =============================================================================
-- Manual bank transfer: customers pay straight into the business's own bank
-- account. The AI shares the account details and records the customer's claim
-- (with any receipt they send); ONLY a person on the business's team can
-- confirm the money arrived. Paystack payments stay automatic (webhook).
-- =============================================================================

create table public.bank_transfer_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  enabled boolean not null default false,
  bank_name text not null check (char_length(bank_name) between 2 and 80),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  account_name text not null check (char_length(account_name) between 2 and 120),
  instructions text check (char_length(instructions) <= 500),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger bank_transfer_settings_updated_at before update on public.bank_transfer_settings
  for each row execute function private.set_updated_at();

alter table public.bank_transfer_settings enable row level security;
-- Account details are shown to customers anyway; any team member may read them.
create policy bank_transfer_settings_select on public.bank_transfer_settings for select to authenticated
  using ((select private.is_member(business_id)));
revoke insert, update, delete on public.bank_transfer_settings from authenticated, anon;

-- Payments: a bank transfer is a payments row with collection_mode 'bank_transfer'.
alter table public.payments drop constraint if exists payments_collection_mode_check;
alter table public.payments
  add constraint payments_collection_mode_check check (collection_mode in ('merchant_key', 'platform_subaccount', 'bank_transfer'));
alter table public.payments drop constraint if exists payments_subaccount_consistent;
alter table public.payments
  add constraint payments_subaccount_consistent check (
    (collection_mode = 'merchant_key' and subaccount_code is null and platform_fee_minor = 0)
    or (collection_mode = 'platform_subaccount' and subaccount_code is not null)
    or (collection_mode = 'bank_transfer' and provider = 'bank_transfer' and subaccount_code is null and platform_fee_minor = 0)
  );

alter table public.payments
  add column if not exists claimed_at timestamptz,                                         -- customer says they've paid
  add column if not exists proof_message_id uuid references public.messages (id) on delete set null, -- receipt they sent
  add column if not exists confirmed_by uuid references auth.users (id) on delete set null, -- team member who confirmed
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_note text check (char_length(rejection_note) <= 300);

-- A bank transfer can only become successful through a person: require who confirmed it.
alter table public.payments
  add constraint payments_bank_transfer_confirmed_by_person check (
    collection_mode <> 'bank_transfer' or status <> 'success' or confirmed_by is not null
  );

create index if not exists payments_claimed_idx on public.payments (business_id, claimed_at) where status = 'pending';

-- Orders awaiting a person to check a claimed bank transfer must not auto-expire.
-- (Existing rule: any payment in 'pending' or 'success' already blocks expiry; a
-- claimed bank transfer is 'pending', so nothing changes here — kept explicit.)
comment on column public.payments.claimed_at is 'Bank transfer: when the customer said they paid. Status is pending until a person confirms or rejects.';

-- A team member confirms a bank transfer arrived (the app checks their
-- orders.manage permission first). Records who, then runs the normal paid
-- transition atomically. Service role only.
create or replace function public.confirm_bank_transfer(p_business_id uuid, p_payment_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'a person must confirm bank transfers' using errcode = '22023';
  end if;
  select * into v_pay from public.payments where business_id = p_business_id and id = p_payment_id for update;
  if not found or v_pay.collection_mode <> 'bank_transfer' then
    raise exception 'bank transfer not found' using errcode = 'P0002';
  end if;
  if v_pay.status = 'success' then
    return jsonb_build_object('outcome', 'already_paid', 'order_id', v_pay.order_id);
  end if;
  update public.payments set confirmed_by = p_user_id, rejected_at = null, rejection_note = null where id = v_pay.id;
  v_result := public.mark_payment_succeeded(p_business_id, v_pay.id, v_pay.amount_minor, v_pay.currency, now(), 'bank_transfer', null,
                                            jsonb_build_object('confirmed_by', p_user_id, 'claimed_at', v_pay.claimed_at));
  insert into public.audit_logs (business_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_business_id, p_user_id, 'user', 'payment.bank_transfer_confirmed', 'order', v_pay.order_id,
          jsonb_build_object('payment_id', v_pay.id, 'amount_minor', v_pay.amount_minor, 'outcome', v_result ->> 'outcome'));
  return v_result;
end;
$$;

-- A team member says the money hasn't arrived: the claim is cleared so the
-- customer can pay or send proof again. Service role only.
create or replace function public.reject_bank_transfer(p_business_id uuid, p_payment_id uuid, p_user_id uuid, p_note text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
begin
  select * into v_pay from public.payments where business_id = p_business_id and id = p_payment_id for update;
  if not found or v_pay.collection_mode <> 'bank_transfer' or v_pay.status = 'success' then
    return false;
  end if;
  update public.payments
     set status = 'initialized', claimed_at = null, rejected_at = now(), rejection_note = left(nullif(trim(p_note), ''), 300)
   where id = v_pay.id;
  insert into public.audit_logs (business_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_business_id, p_user_id, 'user', 'payment.bank_transfer_rejected', 'order', v_pay.order_id,
          jsonb_build_object('payment_id', v_pay.id, 'note', left(p_note, 300)));
  return true;
end;
$$;

revoke execute on function public.confirm_bank_transfer(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reject_bank_transfer(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_bank_transfer(uuid, uuid, uuid) to service_role;
grant execute on function public.reject_bank_transfer(uuid, uuid, uuid, text) to service_role;
