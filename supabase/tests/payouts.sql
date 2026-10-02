-- Bank-account payouts (Paystack subaccounts): access and payment consistency. Rolls back.
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a0c1', 'ownerp@example.com'),
  ('00000000-0000-0000-0000-00000000b0c1', 'staffp@example.com'),
  ('00000000-0000-0000-0000-00000000c0c1', 'otherp@example.com');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a0c1', true);
do $$ begin insert into test.ids values ('a', public.create_business('Payout A')); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c0c1', true);
do $$ begin insert into test.ids values ('b', public.create_business('Payout B')); end $$;
reset role;
insert into public.business_members (business_id, user_id, role, permissions)
values (test.id('a'), '00000000-0000-0000-0000-00000000b0c1', 'staff', '{orders.view}');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare p uuid; cust uuid; oid uuid;
begin
  insert into public.payout_accounts (business_id, bank_code, bank_name, account_number_last4, account_name, subaccount_code)
  values (test.id('a'), '058', 'GTBank', '6789', 'PARFAIT STOP ENTERPRISES', 'ACCT_test_a');

  begin
    insert into public.payout_accounts (business_id, bank_code, bank_name, account_number_last4, account_name, subaccount_code)
    values (test.id('b'), '058', 'GTBank', '12345', 'X', 'ACCT_test_b');
    raise exception 'FAIL: full account number accepted as last4';
  exception when check_violation then null;
  end;
  begin
    insert into public.payout_accounts (business_id, bank_code, bank_name, account_number_last4, account_name, subaccount_code)
    values (test.id('b'), '058', 'GTBank', '1234', 'X', 'ACCT_test_a');
    raise exception 'FAIL: subaccount shared by two businesses';
  exception when unique_violation then null;
  end;

  insert into public.products (business_id, name, price_minor, stock_quantity) values (test.id('a'), 'Parfait', 350000, 10) returning id into p;
  insert into public.customers (business_id, wa_id, phone) values (test.id('a'), '2348000000990', '+2348000000990') returning id into cust;
  oid := public.create_order(test.id('a'), cust, null, jsonb_build_array(jsonb_build_object('product_id', p, 'quantity', 1)), null, '1 Road', 'Ada', 'ai', true, 'po1');

  -- A subaccount payment must name its subaccount; a merchant-key payment can't carry a platform fee.
  begin
    insert into public.payments (business_id, order_id, reference, amount_minor, currency, collection_mode) values (test.id('a'), oid, 'po-1', 350000, 'NGN', 'platform_subaccount');
    raise exception 'FAIL: subaccount payment without subaccount';
  exception when check_violation then null;
  end;
  begin
    insert into public.payments (business_id, order_id, reference, amount_minor, currency, platform_fee_minor) values (test.id('a'), oid, 'po-2', 350000, 'NGN', 100);
    raise exception 'FAIL: fee on merchant-key payment';
  exception when check_violation then null;
  end;
  insert into public.payments (business_id, order_id, reference, amount_minor, currency, collection_mode, subaccount_code, platform_fee_minor)
  values (test.id('a'), oid, 'po-3', 350000, 'NGN', 'platform_subaccount', 'ACCT_test_a', 7000);

  -- The paid path is unchanged for subaccount payments.
  if public.mark_payment_succeeded(test.id('a'), (select id from public.payments where reference = 'po-3'), 350000, 'NGN', now(), 'card', '9', '{}') ->> 'outcome' <> 'paid' then
    raise exception 'FAIL: subaccount payment not marked paid';
  end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a0c1', true);
do $$
begin
  if (select count(*) from public.payout_accounts) <> 1 then raise exception 'FAIL: owner cannot see payout account'; end if;
  begin
    update public.payout_accounts set subaccount_code = 'ACCT_attacker' where business_id = test.id('a');
    raise exception 'FAIL: owner changed subaccount directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payout_accounts (business_id, bank_code, bank_name, account_number_last4, account_name, subaccount_code)
    values (test.id('a'), '1', 'x', '0000', 'x', 'ACCT_x');
    raise exception 'FAIL: owner inserted payout account directly';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0c1', true);
do $$ begin if (select count(*) from public.payout_accounts) <> 0 then raise exception 'FAIL: staff without settings.manage sees payout account'; end if; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c0c1', true);
do $$ begin if (select count(*) from public.payout_accounts) <> 0 then raise exception 'FAIL: other tenant sees payout account'; end if; end $$;
reset role;

\echo 'ALL PAYOUT TESTS PASSED'
rollback;
