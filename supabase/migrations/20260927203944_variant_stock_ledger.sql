-- Products with variants track stock per variant. The product's stock_quantity
-- is a derived total, so don't also log product-level movements for it.
create or replace function private.log_stock_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta integer;
  v_reason text;
  v_order uuid;
  v_product uuid;
  v_variant uuid;
begin
  v_delta := new.stock_quantity - case when tg_op = 'INSERT' then 0 else old.stock_quantity end;
  if v_delta = 0 then
    return new;
  end if;

  if tg_table_name = 'products' then
    if exists (select 1 from public.product_variants v where v.product_id = new.id) then
      return new;
    end if;
    v_product := new.id;
  else
    v_product := (to_jsonb(new) ->> 'product_id')::uuid;
    v_variant := new.id;
  end if;

  v_reason := coalesce(
    nullif(current_setting('sellflow.stock_reason', true), ''),
    case when tg_op = 'INSERT' then 'restock' else 'manual_adjustment' end
  );
  v_order := nullif(current_setting('sellflow.stock_order_id', true), '')::uuid;

  insert into public.inventory_movements (business_id, product_id, variant_id, delta, reason, order_id, actor_user_id)
  values (new.business_id, v_product, v_variant, v_delta, v_reason, v_order, auth.uid());
  return new;
end;
$$;
