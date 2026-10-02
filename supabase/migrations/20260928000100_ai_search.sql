-- Product search for the AI sales agent: full-text (websearch syntax) plus
-- trigram similarity for typos/partial words. Always scoped by p_business_id;
-- SECURITY INVOKER so dashboard callers are additionally bound by RLS.
create or replace function public.search_products(p_business_id uuid, p_query text, p_limit integer default 5)
returns table (
  id uuid,
  name text,
  description text,
  sku text,
  price_minor bigint,
  currency char(3),
  track_inventory boolean,
  stock_quantity integer,
  category text,
  brand text,
  variant_count integer,
  score real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select
      nullif(trim(left(coalesce(p_query, ''), 200)), '') as text,
      -- LIKE-safe needle: wildcard characters removed; too-short needles disable substring matching.
      nullif(regexp_replace(trim(left(coalesce(p_query, ''), 200)), '[%_\\]', '', 'g'), '') as needle,
      websearch_to_tsquery('simple', left(coalesce(p_query, ''), 200)) as ts
  )
  select
    p.id, p.name, left(p.description, 500), p.sku, p.price_minor, p.currency,
    p.track_inventory, p.stock_quantity, p.category, p.brand,
    (select count(*)::integer from public.product_variants v where v.product_id = p.id and v.is_active) as variant_count,
    (ts_rank(p.search_vector, q.ts) * 2
      + extensions.word_similarity(q.text, p.name)
      + extensions.similarity(coalesce(p.category, ''), q.text) * 0.5)::real as score
  from public.products p, q
  where p.business_id = p_business_id
    and p.status = 'active'
    and q.text is not null
    and (
      p.search_vector @@ q.ts
      or extensions.word_similarity(q.text, p.name) > 0.3
      or (char_length(q.needle) >= 2 and p.name ilike '%' || q.needle || '%')
      or (q.needle is not null and p.sku ilike q.needle)
    )
  order by score desc, p.name
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

revoke execute on function public.search_products(uuid, text, integer) from public, anon;
grant execute on function public.search_products(uuid, text, integer) to authenticated, service_role;
