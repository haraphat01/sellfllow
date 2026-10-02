-- CSV import must not overwrite the derived stock total of products that have
-- variants (their stock is managed per variant).
create or replace function public.import_products(p_business_id uuid, p_rows jsonb)
returns table (inserted integer, updated integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_currency char(3);
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no rows to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'too many rows (max 2000)' using errcode = '54000';
  end if;

  select currency into v_currency from public.businesses where id = p_business_id;
  if v_currency is null then
    raise exception 'business not found' using errcode = '42501';
  end if;

  perform set_config('sellflow.stock_reason', 'import', true);

  return query
  with src as (
    select * from jsonb_to_recordset(p_rows) as r(
      name text, description text, sku text, price_minor bigint, stock_quantity integer,
      track_inventory boolean, category text, brand text, status public.product_status
    )
  ),
  upserted as (
    insert into public.products as p
      (business_id, name, description, sku, price_minor, currency, stock_quantity, track_inventory, category, brand, status)
    select p_business_id, s.name, s.description, nullif(s.sku, ''), s.price_minor, v_currency,
           coalesce(s.stock_quantity, 0), coalesce(s.track_inventory, true), s.category, s.brand,
           coalesce(s.status, 'active')
    from src s
    on conflict (business_id, sku) where sku is not null do update set
      name = excluded.name,
      description = coalesce(excluded.description, p.description),
      price_minor = excluded.price_minor,
      stock_quantity = case
        when exists (select 1 from public.product_variants v where v.product_id = p.id) then p.stock_quantity
        else excluded.stock_quantity
      end,
      track_inventory = excluded.track_inventory,
      category = coalesce(excluded.category, p.category),
      brand = coalesce(excluded.brand, p.brand),
      status = excluded.status
    returning (xmax = 0) as was_inserted
  )
  select (count(*) filter (where was_inserted))::integer, (count(*) filter (where not was_inserted))::integer
  from upserted;
end;
$$;

revoke execute on function public.import_products(uuid, jsonb) from public, anon;
grant execute on function public.import_products(uuid, jsonb) to authenticated, service_role;
