-- =============================================================================
-- Phase 6: order quoting, atomic creation with stock reservation, cancellation,
-- expiry. Prices and delivery fees always come from the database — never from
-- the caller (the AI or the browser). All functions are service-role only; the
-- app authorises the user/agent before calling them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- quote_order: prices items + delivery from the catalogue and settings.
-- p_items: [{"product_id": uuid, "variant_id": uuid|null, "quantity": int}]
-- Returns {lines, subtotal_minor, delivery_*, total_minor, currency, problems[]}
-- -----------------------------------------------------------------------------
create or replace function public.quote_order(p_business_id uuid, p_items jsonb, p_delivery_zone text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_currency char(3);
  v_lines jsonb := '[]'::jsonb;
  v_problems jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_fee bigint := 0;
  v_zone jsonb;
  v_item jsonb;
  v_qty integer;
  p record;
  v_var_id uuid;
  v_var_name text;
  v_var_price bigint;
  v_var_stock integer;
  v_has_variants boolean;
  v_price bigint;
  v_stock integer;
begin
  select currency into v_currency from public.businesses where id = p_business_id;
  if v_currency is null then
    raise exception 'business not found';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('lines', '[]'::jsonb, 'problems', jsonb_build_array('no items'), 'currency', v_currency);
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'too many items';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'quantity')::integer, 1);
    if v_qty < 1 or v_qty > 100 then
      v_problems := v_problems || to_jsonb('invalid quantity'::text);
      continue;
    end if;

    select id, name, price_minor, track_inventory, stock_quantity into p
      from public.products
     where business_id = p_business_id and id = nullif(v_item ->> 'product_id', '')::uuid and status = 'active';
    if not found then
      v_problems := v_problems || to_jsonb('product not found'::text);
      continue;
    end if;

    select exists (select 1 from public.product_variants x where x.product_id = p.id and x.is_active) into v_has_variants;
    v_var_id := null; v_var_name := null; v_var_price := null; v_var_stock := null;
    if nullif(v_item ->> 'variant_id', '') is not null then
      select id, name, price_minor, stock_quantity into v_var_id, v_var_name, v_var_price, v_var_stock
        from public.product_variants
       where business_id = p_business_id and product_id = p.id and id = (v_item ->> 'variant_id')::uuid and is_active;
      if v_var_id is null then
        v_problems := v_problems || to_jsonb(format('variant not found for %s', p.name));
        continue;
      end if;
    elsif v_has_variants then
      v_problems := v_problems || to_jsonb(format('choose a variant for %s', p.name));
      continue;
    end if;

    v_price := coalesce(v_var_price, p.price_minor);
    v_stock := case when v_var_id is not null then v_var_stock else p.stock_quantity end;
    if p.track_inventory and v_stock < v_qty then
      v_problems := v_problems || to_jsonb(format('only %s of %s%s in stock', v_stock, p.name, coalesce(' (' || v_var_name || ')', '')));
    end if;

    v_subtotal := v_subtotal + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'product_id', p.id, 'variant_id', v_var_id, 'name', p.name, 'variant_label', v_var_name,
      'unit_price_minor', v_price, 'quantity', v_qty, 'total_minor', v_price * v_qty,
      'available', (not p.track_inventory) or v_stock >= v_qty
    );
  end loop;

  if nullif(trim(coalesce(p_delivery_zone, '')), '') is not null then
    select z.value into v_zone
      from public.ai_settings s, jsonb_array_elements(s.delivery_zones) as z(value)
     where s.business_id = p_business_id and lower(trim(z.value ->> 'name')) = lower(trim(p_delivery_zone))
     limit 1;
    if v_zone is null then
      v_problems := v_problems || to_jsonb(format('unknown delivery zone "%s"', p_delivery_zone));
    else
      v_fee := coalesce((v_zone ->> 'fee_minor')::bigint, 0);
    end if;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'subtotal_minor', v_subtotal,
    'delivery_zone', v_zone ->> 'name',
    'delivery_fee_minor', v_fee,
    'delivery_eta', v_zone ->> 'eta',
    'total_minor', v_subtotal + v_fee,
    'currency', v_currency,
    'problems', v_problems
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- create_order: re-quotes under row locks, reserves stock, creates the order.
-- Idempotent on (business_id, idempotency_key). Raises on any problem.
-- -----------------------------------------------------------------------------
create or replace function public.create_order(
  p_business_id uuid,
  p_customer_id uuid,
  p_conversation_id uuid,
  p_items jsonb,
  p_delivery_zone text,
  p_delivery_address text,
  p_customer_name text,
  p_source public.order_source,
  p_ai_assisted boolean,
  p_idempotency_key text,
  p_created_by uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_order_id uuid := gen_random_uuid();
  v_quote jsonb;
  v_line jsonb;
  v_phone text;
  v_currency char(3);
begin
  if p_idempotency_key is not null then
    select id into v_existing from public.orders where business_id = p_business_id and idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select phone into v_phone from public.customers where business_id = p_business_id and id = p_customer_id;
  if v_phone is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if char_length(coalesce(trim(p_customer_name), '')) < 2 then
    raise exception 'customer name is required' using errcode = '22023';
  end if;
  if char_length(coalesce(trim(p_delivery_address), '')) < 5 then
    raise exception 'delivery address is required' using errcode = '22023';
  end if;

  -- Lock the products/variants involved (stable order avoids deadlocks).
  perform 1 from public.products
   where business_id = p_business_id
     and id in (select (x ->> 'product_id')::uuid from jsonb_array_elements(p_items) x)
   order by id for update;
  perform 1 from public.product_variants
   where business_id = p_business_id
     and id in (select nullif(x ->> 'variant_id', '')::uuid from jsonb_array_elements(p_items) x)
   order by id for update;

  v_quote := public.quote_order(p_business_id, p_items, p_delivery_zone);
  if jsonb_array_length(v_quote -> 'problems') > 0 then
    raise exception 'order not possible: %', (select string_agg(value #>> '{}', '; ') from jsonb_array_elements(v_quote -> 'problems')) using errcode = '22023';
  end if;
  v_currency := v_quote ->> 'currency';

  insert into public.orders (
    id, business_id, customer_id, conversation_id, status, source, currency,
    subtotal_minor, delivery_fee_minor, discount_minor, total_minor,
    customer_name, customer_phone, delivery_address, notes, ai_assisted,
    idempotency_key, created_by, confirmed_by_customer_at
  ) values (
    v_order_id, p_business_id, p_customer_id, p_conversation_id, 'pending_payment', p_source, v_currency,
    (v_quote ->> 'subtotal_minor')::bigint, (v_quote ->> 'delivery_fee_minor')::bigint, 0, (v_quote ->> 'total_minor')::bigint,
    trim(p_customer_name), v_phone,
    jsonb_build_object('address', trim(p_delivery_address), 'zone', v_quote ->> 'delivery_zone', 'eta', v_quote ->> 'delivery_eta'),
    p_notes, coalesce(p_ai_assisted, false), p_idempotency_key, p_created_by,
    case when p_source = 'ai' then now() else null end
  );

  perform set_config('sellflow.stock_reason', 'order_reserved', true);
  perform set_config('sellflow.stock_order_id', v_order_id::text, true);

  for v_line in select * from jsonb_array_elements(v_quote -> 'lines') loop
    insert into public.order_items (business_id, order_id, product_id, variant_id, name, variant_label, unit_price_minor, quantity, total_minor)
    values (p_business_id, v_order_id, (v_line ->> 'product_id')::uuid, nullif(v_line ->> 'variant_id', '')::uuid,
            v_line ->> 'name', v_line ->> 'variant_label', (v_line ->> 'unit_price_minor')::bigint,
            (v_line ->> 'quantity')::integer, (v_line ->> 'total_minor')::bigint);

    if nullif(v_line ->> 'variant_id', '') is not null then
      update public.product_variants
         set stock_quantity = stock_quantity - (v_line ->> 'quantity')::integer
       where id = (v_line ->> 'variant_id')::uuid
         and exists (select 1 from public.products p where p.id = (v_line ->> 'product_id')::uuid and p.track_inventory);
      update public.products p
         set stock_quantity = (select coalesce(sum(x.stock_quantity), 0) from public.product_variants x where x.product_id = p.id)
       where p.id = (v_line ->> 'product_id')::uuid and p.track_inventory;
    else
      update public.products
         set stock_quantity = stock_quantity - (v_line ->> 'quantity')::integer
       where id = (v_line ->> 'product_id')::uuid and track_inventory;
    end if;
  end loop;

  perform set_config('sellflow.stock_reason', '', true);
  perform set_config('sellflow.stock_order_id', '', true);

  insert into public.audit_logs (business_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_business_id, p_created_by, case when p_source = 'ai' then 'ai' else 'user' end, 'order.created', 'order', v_order_id,
          jsonb_build_object('total_minor', v_quote ->> 'total_minor', 'source', p_source));

  return v_order_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- cancel_order: unpaid orders only; returns reserved stock to inventory.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_order(p_business_id uuid, p_order_id uuid, p_reason text, p_actor uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_item record;
begin
  select id, status, paid_at into v_order from public.orders
   where business_id = p_business_id and id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status = 'cancelled' then
    return false;
  end if;
  if v_order.paid_at is not null or v_order.status not in ('draft', 'pending_payment') then
    raise exception 'paid orders must be refunded, not cancelled' using errcode = '22023';
  end if;

  perform set_config('sellflow.stock_reason', 'order_released', true);
  perform set_config('sellflow.stock_order_id', p_order_id::text, true);
  for v_item in select product_id, variant_id, quantity from public.order_items where order_id = p_order_id loop
    if v_item.variant_id is not null then
      update public.product_variants set stock_quantity = stock_quantity + v_item.quantity
       where id = v_item.variant_id
         and exists (select 1 from public.products p where p.id = v_item.product_id and p.track_inventory);
      update public.products p
         set stock_quantity = (select coalesce(sum(x.stock_quantity), 0) from public.product_variants x where x.product_id = p.id)
       where p.id = v_item.product_id and p.track_inventory;
    elsif v_item.product_id is not null then
      update public.products set stock_quantity = stock_quantity + v_item.quantity
       where id = v_item.product_id and track_inventory;
    end if;
  end loop;
  perform set_config('sellflow.stock_reason', '', true);
  perform set_config('sellflow.stock_order_id', '', true);

  update public.orders set status = 'cancelled', cancelled_at = now(),
         notes = concat_ws(E'\n', nullif(notes, ''), 'Cancelled: ' || coalesce(nullif(trim(p_reason), ''), 'no reason given'))
   where id = p_order_id;

  insert into public.audit_logs (business_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_business_id, p_actor, case when p_actor is null then 'system' else 'user' end, 'order.cancelled', 'order', p_order_id,
          jsonb_build_object('reason', p_reason));
  return true;
end;
$$;

-- Cancels unpaid orders older than p_older_than (releases their stock).
create or replace function public.expire_stale_orders(p_older_than interval default interval '48 hours')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select id, business_id from public.orders
     where status = 'pending_payment' and paid_at is null and created_at < now() - p_older_than
       and not exists (select 1 from public.payments pay where pay.order_id = orders.id and pay.status in ('pending', 'success'))
     order by created_at
     limit 500
  loop
    if public.cancel_order(v_order.business_id, v_order.id, 'Payment not received in time', null) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.quote_order(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.create_order(uuid, uuid, uuid, jsonb, text, text, text, public.order_source, boolean, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.cancel_order(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.expire_stale_orders(interval) from public, anon, authenticated;
grant execute on function public.quote_order(uuid, jsonb, text) to service_role;
grant execute on function public.create_order(uuid, uuid, uuid, jsonb, text, text, text, public.order_source, boolean, text, uuid, text) to service_role;
grant execute on function public.cancel_order(uuid, uuid, text, uuid) to service_role;
grant execute on function public.expire_stale_orders(interval) to service_role;

-- -----------------------------------------------------------------------------
-- Tighter guard for dashboard users: cancellation goes through cancel_order
-- (so stock is released), and status can't move backwards.
-- -----------------------------------------------------------------------------
create or replace function private.guard_order_payment_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_service boolean := coalesce(auth.role(), '') = 'service_role'
                        or current_user in ('postgres', 'supabase_admin', 'service_role');
  rank_old integer;
  rank_new integer;
begin
  if is_service then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'orders are created by SellFlow (create_order)';
  end if;

  if (new.status in ('paid', 'refunded', 'cancelled', 'draft', 'pending_payment') and new.status is distinct from old.status)
     or new.paid_at is distinct from old.paid_at
     or new.cancelled_at is distinct from old.cancelled_at
     or new.total_minor is distinct from old.total_minor
     or new.subtotal_minor is distinct from old.subtotal_minor
     or new.delivery_fee_minor is distinct from old.delivery_fee_minor
     or new.discount_minor is distinct from old.discount_minor
     or new.ai_assisted is distinct from old.ai_assisted
     or new.recovered_by_follow_up_id is distinct from old.recovered_by_follow_up_id
     or new.customer_id is distinct from old.customer_id then
    raise exception 'payment state, totals and cancellation are managed by SellFlow';
  end if;

  if new.status in ('processing', 'shipped', 'delivered') and new.status is distinct from old.status then
    if old.paid_at is null then
      raise exception 'order must be paid before fulfilment';
    end if;
    rank_old := array_position(array['paid', 'processing', 'shipped', 'delivered'], old.status::text);
    rank_new := array_position(array['paid', 'processing', 'shipped', 'delivered'], new.status::text);
    if rank_old is null or rank_new <= rank_old then
      raise exception 'order status can only move forward';
    end if;
  end if;

  return new;
end;
$$;

-- Dashboard users may edit fulfilment fields only.
revoke insert, update on public.orders from authenticated;
grant update (status, notes, delivery_address, customer_name) on public.orders to authenticated;
