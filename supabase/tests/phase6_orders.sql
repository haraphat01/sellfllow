-- Phase 6: quoting, atomic order creation + stock reservation, cancel, expiry, guards. Rolls back.
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'a6@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'b6@example.com');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
do $$ begin insert into test.ids values ('a', public.create_business('Orders A')); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
do $$ begin insert into test.ids values ('b', public.create_business('Orders B')); end $$;
reset role;

-- Catalogue + settings + customer (as superuser).
do $$
declare p1 uuid; p2 uuid; p3 uuid; v1 uuid; v2 uuid; pb uuid; cust uuid;
begin
  insert into public.products (business_id, name, price_minor, stock_quantity) values (test.id('a'), 'Belt', 1000000, 3) returning id into p1;
  insert into public.products (business_id, name, price_minor, stock_quantity) values (test.id('a'), 'Shoe', 2000000, 0) returning id into p2;
  insert into public.product_variants (business_id, product_id, name, price_minor, stock_quantity) values (test.id('a'), p2, 'Size 42', 1500000, 2) returning id into v1;
  insert into public.product_variants (business_id, product_id, name, stock_quantity) values (test.id('a'), p2, 'Size 44', 0) returning id into v2;
  update public.products set stock_quantity = 2 where id = p2;
  insert into public.products (business_id, name, price_minor, track_inventory, stock_quantity) values (test.id('a'), 'Gift wrap', 50000, false, 0) returning id into p3;
  insert into public.products (business_id, name, price_minor, stock_quantity) values (test.id('b'), 'Other shop item', 100, 99) returning id into pb;
  update public.ai_settings set delivery_zones = '[{"name":"Lagos Mainland","fee_minor":300000,"eta":"1-2 days"}]' where business_id = test.id('a');
  insert into public.customers (business_id, wa_id, phone, name) values (test.id('a'), '2348000000600', '+2348000000600', 'Ngozi') returning id into cust;
  insert into test.ids values ('p1', p1), ('p2', p2), ('p3', p3), ('v1', v1), ('v2', v2), ('pb', pb), ('cust', cust);
end $$;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare q jsonb; oid uuid; oid2 uuid; n int;
begin
  -- Quote: prices from DB, delivery from settings.
  q := public.quote_order(test.id('a'), jsonb_build_array(
         jsonb_build_object('product_id', test.id('p1'), 'quantity', 2),
         jsonb_build_object('product_id', test.id('p2'), 'variant_id', test.id('v1'), 'quantity', 1),
         jsonb_build_object('product_id', test.id('p3'), 'quantity', 5)), 'lagos mainland');
  if jsonb_array_length(q -> 'problems') <> 0 then raise exception 'FAIL: unexpected problems %', q -> 'problems'; end if;
  if (q ->> 'subtotal_minor')::bigint <> 2000000 + 1500000 + 250000 then raise exception 'FAIL: subtotal %', q ->> 'subtotal_minor'; end if;
  if (q ->> 'delivery_fee_minor')::bigint <> 300000 or (q ->> 'total_minor')::bigint <> 4050000 then raise exception 'FAIL: totals %', q; end if;

  -- Quote problems.
  q := public.quote_order(test.id('a'), jsonb_build_array(jsonb_build_object('product_id', test.id('p2'), 'quantity', 1)), null);
  if (q -> 'problems') ->> 0 not like 'choose a variant%' then raise exception 'FAIL: variant required %', q -> 'problems'; end if;
  q := public.quote_order(test.id('a'), jsonb_build_array(jsonb_build_object('product_id', test.id('p2'), 'variant_id', test.id('v2'), 'quantity', 1)), null);
  if (q -> 'problems') ->> 0 not like 'only 0 of Shoe (Size 44)%' then raise exception 'FAIL: out of stock %', q -> 'problems'; end if;
  q := public.quote_order(test.id('a'), jsonb_build_array(jsonb_build_object('product_id', test.id('pb'), 'quantity', 1)), null);
  if (q -> 'problems') ->> 0 <> 'product not found' then raise exception 'FAIL: cross-tenant product quoted %', q; end if;
  q := public.quote_order(test.id('a'), jsonb_build_array(jsonb_build_object('product_id', test.id('p1'), 'quantity', 1)), 'Mars');
  if (q -> 'problems') ->> 0 not like 'unknown delivery zone%' then raise exception 'FAIL: unknown zone %', q; end if;

  -- Create: reserves stock atomically and records the ledger.
  oid := public.create_order(test.id('a'), test.id('cust'), null, jsonb_build_array(
           jsonb_build_object('product_id', test.id('p1'), 'quantity', 2),
           jsonb_build_object('product_id', test.id('p2'), 'variant_id', test.id('v1'), 'quantity', 1)),
         'Lagos Mainland', '12 Herbert Macaulay Way, Yaba', 'Ngozi', 'ai', true, 'conv-1:quote-1');
  if (select total_minor from public.orders where id = oid) <> 3800000 then raise exception 'FAIL: order total'; end if;
  if (select status from public.orders where id = oid) <> 'pending_payment' then raise exception 'FAIL: order status'; end if;
  if (select count(*) from public.order_items where order_id = oid) <> 2 then raise exception 'FAIL: items'; end if;
  if (select stock_quantity from public.products where id = test.id('p1')) <> 1 then raise exception 'FAIL: p1 stock not reserved'; end if;
  if (select stock_quantity from public.product_variants where id = test.id('v1')) <> 1 then raise exception 'FAIL: v1 stock not reserved'; end if;
  if (select stock_quantity from public.products where id = test.id('p2')) <> 1 then raise exception 'FAIL: variant product total not synced'; end if;
  if (select count(*) from public.inventory_movements where order_id = oid and reason = 'order_reserved') <> 2 then
    raise exception 'FAIL: reservation ledger %', (select array_agg(reason || ':' || delta) from public.inventory_movements where order_id = oid);
  end if;

  -- Idempotent retry.
  oid2 := public.create_order(test.id('a'), test.id('cust'), null, jsonb_build_array(jsonb_build_object('product_id', test.id('p1'), 'quantity', 2)),
          'Lagos Mainland', '12 Herbert Macaulay Way, Yaba', 'Ngozi', 'ai', true, 'conv-1:quote-1');
  if oid2 <> oid then raise exception 'FAIL: idempotency'; end if;
  if (select stock_quantity from public.products where id = test.id('p1')) <> 1 then raise exception 'FAIL: idempotent retry reserved again'; end if;

  -- Over-ordering fails with nothing reserved.
  begin
    perform public.create_order(test.id('a'), test.id('cust'), null, jsonb_build_array(
      jsonb_build_object('product_id', test.id('p3'), 'quantity', 1),
      jsonb_build_object('product_id', test.id('p1'), 'quantity', 5)), null, '12 Herbert Macaulay Way', 'Ngozi', 'ai', true, 'k2');
    raise exception 'FAIL: over-order accepted';
  exception when invalid_parameter_value then null;
  end;
  if (select stock_quantity from public.products where id = test.id('p1')) <> 1 then raise exception 'FAIL: failed order leaked a reservation'; end if;

  -- Missing name/address rejected; other tenant's customer rejected.
  begin
    perform public.create_order(test.id('a'), test.id('cust'), null, jsonb_build_array(jsonb_build_object('product_id', test.id('p1'), 'quantity', 1)), null, '', 'Ngozi', 'ai', true, 'k3');
    raise exception 'FAIL: order without address';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_order(test.id('b'), test.id('cust'), null, jsonb_build_array(jsonb_build_object('product_id', test.id('pb'), 'quantity', 1)), null, '1 Some Street', 'X', 'ai', true, 'k4');
    raise exception 'FAIL: cross-tenant customer accepted';
  exception when no_data_found then null;
  end;

  -- Cancel releases stock.
  if not public.cancel_order(test.id('a'), oid, 'changed mind', null) then raise exception 'FAIL: cancel'; end if;
  if (select stock_quantity from public.products where id = test.id('p1')) <> 3 then raise exception 'FAIL: cancel did not release p1'; end if;
  if (select stock_quantity from public.product_variants where id = test.id('v1')) <> 2 then raise exception 'FAIL: cancel did not release v1'; end if;
  if (select stock_quantity from public.products where id = test.id('p2')) <> 2 then raise exception 'FAIL: cancel did not resync p2'; end if;
  if (select count(*) from public.inventory_movements where order_id = oid and reason = 'order_released') <> 2 then raise exception 'FAIL: release ledger'; end if;
  if public.cancel_order(test.id('a'), oid, 'again', null) then raise exception 'FAIL: double cancel'; end if;
  if (select notes from public.orders where id = oid) is not null then raise exception 'FAIL: cancel wrote into internal notes'; end if;
  if (select metadata ->> 'reason' from public.audit_logs where entity_id = oid and action = 'order.cancelled') <> 'changed mind' then raise exception 'FAIL: cancel reason not in history'; end if;
  if jsonb_typeof((select metadata -> 'total_minor' from public.audit_logs where entity_id = oid and action = 'order.created')) <> 'number' then raise exception 'FAIL: history total not numeric'; end if;

  -- Paid orders can't be cancelled (they need a refund).
  oid := public.create_order(test.id('a'), test.id('cust'), null, jsonb_build_array(jsonb_build_object('product_id', test.id('p1'), 'quantity', 1)), null, '12 Herbert Macaulay Way', 'Ngozi', 'ai', true, 'k5');
  update public.orders set status = 'paid', paid_at = now() where id = oid;
  begin
    perform public.cancel_order(test.id('a'), oid, 'x', null);
    raise exception 'FAIL: paid order cancelled';
  exception when invalid_parameter_value then null;
  end;
  insert into test.ids values ('paid_order', oid);

  -- Expiry cancels stale unpaid orders and releases stock.
  oid := public.create_order(test.id('a'), test.id('cust'), null, jsonb_build_array(jsonb_build_object('product_id', test.id('p1'), 'quantity', 1)), null, '12 Herbert Macaulay Way', 'Ngozi', 'ai', true, 'k6');
  update public.orders set created_at = now() - interval '3 days' where id = oid;
  n := public.expire_stale_orders(interval '48 hours');
  if n <> 1 or (select status from public.orders where id = oid) <> 'cancelled' then raise exception 'FAIL: expiry (%)', n; end if;
  if (select stock_quantity from public.products where id = test.id('p1')) <> 2 then raise exception 'FAIL: expiry did not release stock'; end if;
  insert into test.ids values ('expired_order', oid);
end $$;
reset role;

-- Dashboard user (owner): fulfilment only.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
do $$
declare n int;
begin
  begin
    perform public.create_order(test.id('a'), test.id('cust'), null, '[]'::jsonb, null, 'x', 'x', 'staff', false, null);
    raise exception 'FAIL: dashboard called create_order';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.quote_order(test.id('a'), '[]'::jsonb, null);
    raise exception 'FAIL: dashboard called quote_order';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.orders (business_id, customer_id, subtotal_minor, total_minor, customer_name, customer_phone, source)
    values (test.id('a'), test.id('cust'), 1, 1, 'x', 'y', 'staff');
    raise exception 'FAIL: dashboard inserted order';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.orders set status = 'cancelled' where id = test.id('paid_order');
    raise exception 'FAIL: dashboard cancelled directly';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  update public.orders set status = 'processing', notes = 'packing' where id = test.id('paid_order');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: owner cannot mark processing'; end if;
  update public.orders set status = 'shipped' where id = test.id('paid_order');
  begin
    update public.orders set status = 'processing' where id = test.id('paid_order');
    raise exception 'FAIL: status moved backwards';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    update public.orders set status = 'processing' where id = test.id('expired_order');
    raise exception 'FAIL: unpaid order fulfilled';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
reset role;

\echo 'ALL PHASE 6 TESTS PASSED'
rollback;
