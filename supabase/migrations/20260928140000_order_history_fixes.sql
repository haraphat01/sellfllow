-- Cancellation reasons live in the order history (audit log), not in the
-- team's internal notes; order history stores totals as numbers.
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
          jsonb_build_object('total_minor', (v_quote -> 'total_minor'), 'source', p_source));

  return v_order_id;
end;
$$;

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

  update public.orders set status = 'cancelled', cancelled_at = now() where id = p_order_id;

  insert into public.audit_logs (business_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_business_id, p_actor, case when p_actor is null then 'system' else 'user' end, 'order.cancelled', 'order', p_order_id,
          jsonb_build_object('reason', p_reason));
  return true;
end;
$$;
