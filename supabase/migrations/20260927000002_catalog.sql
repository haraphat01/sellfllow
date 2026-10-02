-- =============================================================================
-- Product catalogue. Money is stored as integer minor units (kobo for NGN).
-- =============================================================================

create type public.product_status as enum ('active', 'draft', 'archived');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  sku text,
  price_minor bigint not null check (price_minor >= 0),
  currency char(3) not null default 'NGN',
  track_inventory boolean not null default true,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  status public.product_status not null default 'active',
  category text,
  brand text,
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(brand, '') || ' ' || coalesce(category, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_business_status_idx on public.products (business_id, status, created_at desc);
create unique index products_business_sku_uniq on public.products (business_id, sku) where sku is not null;
create index products_search_idx on public.products using gin (search_vector);
create index products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);

create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  sku text,
  options jsonb not null default '{}'::jsonb, -- e.g. {"color":"black","size":"42"}
  price_minor bigint check (price_minor >= 0), -- null => product price
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_variants_product_idx on public.product_variants (product_id);
create index product_variants_business_idx on public.product_variants (business_id);
create unique index product_variants_business_sku_uniq on public.product_variants (business_id, sku) where sku is not null;

create trigger product_variants_updated_at before update on public.product_variants
  for each row execute function private.set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null, -- "<business_id>/<product_id>/<file>" in bucket product-images
  alt text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index product_images_product_idx on public.product_images (product_id, position);
create index product_images_business_idx on public.product_images (business_id);

-- Inventory ledger ("inventory"): every stock change is recorded.
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('manual_adjustment', 'import', 'order_reserved', 'order_released', 'order_fulfilled', 'restock')),
  order_id uuid,
  actor_user_id uuid references auth.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);
create index inventory_movements_business_idx on public.inventory_movements (business_id, created_at desc);

-- Keep child rows in the same tenant as their parent product.
create or replace function private.enforce_product_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.products p
    where p.id = new.product_id and p.business_id = new.business_id
  ) then
    raise exception 'product % does not belong to business %', new.product_id, new.business_id;
  end if;
  return new;
end;
$$;

create trigger product_variants_tenant before insert or update on public.product_variants
  for each row execute function private.enforce_product_tenant();
create trigger product_images_tenant before insert or update on public.product_images
  for each row execute function private.enforce_product_tenant();
create trigger inventory_movements_tenant before insert or update on public.inventory_movements
  for each row execute function private.enforce_product_tenant();

-- -----------------------------------------------------------------------------
-- Storage: product images. Path prefix is the business_id.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "product images: members upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (select private.has_perm(((storage.foldername(name))[1])::uuid, 'products.manage'))
  );

create policy "product images: members update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and (select private.has_perm(((storage.foldername(name))[1])::uuid, 'products.manage'))
  );

create policy "product images: members delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (select private.has_perm(((storage.foldername(name))[1])::uuid, 'products.manage'))
  );
