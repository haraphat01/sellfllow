-- Manual bank transfer: only a person can confirm; access rules. Rolls back.
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000b7a01', 'ownerbt@example.com'),
  ('00000000-0000-0000-0000-0000000b7a02', 'otherbt@example.com');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000b7a01', true);
do $$ begin insert into test.ids values ('a', public.create_business('Transfer A')); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000b7a02', true);
do $$ begin insert into test.ids values ('b', public.create_business('Transfer B')); end $$;
reset role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare p uuid; cust uuid; conv uuid; wa uuid; oid uuid; pay uuid; r jsonb;
begin
  insert into public.bank_transfer_settings (business_id, enabled, bank_name, account_number, account_name)
  values (test.id('a'), true, 'GTBank', '0123456789', 'PARFAIT STOP');
  begin
    insert into public.bank_transfer_settings (business_id, enabled, bank_name, account_number, account_name) values (test.id('b'), true, 'GTBank', '12345', 'X');
    raise exception 'FAIL: short account number accepted';
  exception when check_violation then null;
  end;

  insert into public.products (business_id, name, price_minor, stock_quantity) values (test.id('a'), 'Parfait', 350000, 10) returning id into p;
  insert into public.customers (business_id, wa_id, phone) values (test.id('a'), '2348000000777', '+2348000000777') returning id into cust;
  insert into public.whatsapp_accounts (business_id, waba_id, phone_number_id, status) values (test.id('a'), 'wbt', 'pnbt', 'connected') returning id into wa;
  insert into public.conversations (business_id, customer_id, whatsapp_account_id, sales_outcome) values (test.id('a'), cust, wa, 'interested_not_purchased') returning id into conv;
  oid := public.create_order(test.id('a'), cust, conv, jsonb_build_array(jsonb_build_object('product_id', p, 'quantity', 2)), null, '1 Road', 'Ada', 'ai', true, 'bt1');

  -- A bank transfer row must say provider bank_transfer.
  begin
    insert into public.payments (business_id, order_id, reference, amount_minor, currency, collection_mode) values (test.id('a'), oid, 'bt-x', 700000, 'NGN', 'bank_transfer');
    raise exception 'FAIL: bank transfer with paystack provider accepted';
  exception when check_violation then null;
  end;
  insert into public.payments (business_id, order_id, provider, reference, amount_minor, currency, collection_mode)
  values (test.id('a'), oid, 'bank_transfer', 'bt-1', 700000, 'NGN', 'bank_transfer') returning id into pay;
  insert into test.ids values ('pay', pay), ('order', oid);

  -- Nothing can mark it paid without a person: the generic transition is blocked by the constraint.
  begin
    perform public.mark_payment_succeeded(test.id('a'), pay, 700000, 'NGN', now(), 'bank_transfer', null, '{}');
    raise exception 'FAIL: bank transfer marked paid without a person';
  exception when check_violation then null;
  end;
  begin
    perform public.confirm_bank_transfer(test.id('a'), pay, null);
    raise exception 'FAIL: confirmed without a user';
  exception when invalid_parameter_value then null;
  end;

  -- Customer claims; a person rejects (claim cleared), then the customer claims again and a person confirms.
  update public.payments set status = 'pending', claimed_at = now() where id = pay;
  if (select count(*) from public.expire_stale_orders(interval '0 seconds')) is null then null; end if;
  if (select status from public.orders where id = oid) <> 'pending_payment' then raise exception 'FAIL: claimed order expired'; end if;
  if not public.reject_bank_transfer(test.id('a'), pay, '00000000-0000-0000-0000-0000000b7a01', 'Not in our account') then raise exception 'FAIL: reject'; end if;
  if (select row(status::text, claimed_at, rejection_note) from public.payments where id = pay) is distinct from row('initialized'::text, null::timestamptz, 'Not in our account'::text) then raise exception 'FAIL: reject fields'; end if;

  update public.payments set status = 'pending', claimed_at = now() where id = pay;
  r := public.confirm_bank_transfer(test.id('a'), pay, '00000000-0000-0000-0000-0000000b7a01');
  if r ->> 'outcome' <> 'paid' then raise exception 'FAIL: confirm %', r; end if;
  if (select row(status::text, channel, confirmed_by) from public.payments where id = pay) is distinct from row('success'::text, 'bank_transfer'::text, '00000000-0000-0000-0000-0000000b7a01'::uuid) then raise exception 'FAIL: payment after confirm'; end if;
  if (select status from public.orders where id = oid) <> 'paid' then raise exception 'FAIL: order not paid'; end if;
  if (select sales_outcome from public.conversations where id = conv) <> 'purchased' then raise exception 'FAIL: conversation outcome'; end if;
  if not exists (select 1 from public.audit_logs where entity_id = oid and action = 'payment.bank_transfer_confirmed' and actor_user_id = '00000000-0000-0000-0000-0000000b7a01') then raise exception 'FAIL: confirm not audited'; end if;
  if public.confirm_bank_transfer(test.id('a'), pay, '00000000-0000-0000-0000-0000000b7a01') ->> 'outcome' <> 'already_paid' then raise exception 'FAIL: double confirm'; end if;
  if public.reject_bank_transfer(test.id('a'), pay, '00000000-0000-0000-0000-0000000b7a01', 'x') then raise exception 'FAIL: rejected a confirmed payment'; end if;

  -- Another business can't confirm this payment.
  begin
    perform public.confirm_bank_transfer(test.id('b'), pay, '00000000-0000-0000-0000-0000000b7a02');
    raise exception 'FAIL: cross-tenant confirm';
  exception when no_data_found then null;
  end;
end $$;
reset role;

-- Team members read their own settings only and can't write them or call the functions.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000b7a01', true);
do $$
begin
  if (select count(*) from public.bank_transfer_settings) <> 1 then raise exception 'FAIL: owner cannot read settings'; end if;
  begin
    update public.bank_transfer_settings set account_number = '9999999999';
    raise exception 'FAIL: owner wrote settings directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.confirm_bank_transfer(test.id('a'), test.id('pay'), '00000000-0000-0000-0000-0000000b7a01');
    raise exception 'FAIL: dashboard called confirm directly';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000b7a02', true);
do $$ begin if (select count(*) from public.bank_transfer_settings) <> 0 then raise exception 'FAIL: other tenant sees bank details'; end if; end $$;
reset role;

\echo 'ALL BANK TRANSFER TESTS PASSED'
rollback;
