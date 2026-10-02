-- =============================================================================
-- Phase 2: team management, invitations, inventory ledger, product import.
-- Runs in a transaction and rolls back.
-- =============================================================================
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'agent@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'other@example.com');

-- Owner creates the business.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$ begin insert into test.ids values ('biz', public.create_business('Kwara Shoes', 'shoes')); end $$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
do $$
begin
  -- manager (admin) and agent (staff) invitations; tokens are 'tok-manager' / 'tok-agent'
  insert into public.business_invitations (business_id, email, role, permissions, token_hash, invited_by)
  values (test.id('biz'), 'manager@example.com', 'admin', '{}', encode(extensions.digest('tok-manager', 'sha256'), 'hex'), auth.uid()),
         (test.id('biz'), 'agent@example.com', 'staff', '{conversations.view,conversations.reply}', encode(extensions.digest('tok-agent', 'sha256'), 'hex'), auth.uid());

  begin
    insert into public.business_invitations (business_id, email, role, token_hash, invited_by)
    values (test.id('biz'), 'x@example.com', 'owner', 'h1', auth.uid());
    raise exception 'FAIL: owner invitation accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.business_invitations (business_id, email, role, permissions, token_hash, invited_by)
    values (test.id('biz'), 'y@example.com', 'staff', '{delete.everything}', 'h2', auth.uid());
    raise exception 'FAIL: unknown permission accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

-- Wrong user cannot accept someone else's invitation.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
declare r record;
begin
  select * into r from public.get_invitation('tok-agent');
  if r.business_name <> 'Kwara Shoes' or r.role <> 'staff' then raise exception 'FAIL: get_invitation'; end if;
  if (select count(*) from public.get_invitation('wrong-token')) <> 0 then raise exception 'FAIL: bogus token matched'; end if;

  begin
    perform public.accept_invitation('tok-agent');
    raise exception 'FAIL: accepted invitation for another email';
  exception when insufficient_privilege then null;
  end;

  -- Outsider sees nothing of the business.
  if (select count(*) from public.business_invitations) <> 0 then raise exception 'FAIL: outsider sees invitations'; end if;
end $$;

-- Agent and manager accept.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
do $$
begin
  if public.accept_invitation('tok-agent') <> test.id('biz') then raise exception 'FAIL: accept returned wrong business'; end if;
  begin
    perform public.accept_invitation('tok-agent');
    raise exception 'FAIL: invitation reused';
  exception when invalid_parameter_value then null;
  end;
  if not private.has_perm(test.id('biz'), 'conversations.reply') then raise exception 'FAIL: agent lacks granted perm'; end if;
  if private.has_perm(test.id('biz'), 'products.manage') then raise exception 'FAIL: agent has ungranted perm'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
do $$ begin perform public.accept_invitation('tok-manager'); end $$;

-- ---------------------------------------------------------------------------
-- Member management rules
-- ---------------------------------------------------------------------------
-- Admin (manager): can edit staff, cannot touch owner, cannot promote to admin, cannot edit self.
do $$
declare n int;
begin
  update public.business_members set permissions = '{conversations.view}'
   where business_id = test.id('biz') and user_id = '00000000-0000-0000-0000-0000000000a3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: admin cannot edit staff'; end if;

  update public.business_members set role = 'staff'
   where business_id = test.id('biz') and user_id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: admin demoted owner'; end if;

  delete from public.business_members where business_id = test.id('biz') and role = 'owner';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: admin removed owner'; end if;

  update public.business_members set permissions = '{billing.manage}'
   where business_id = test.id('biz') and user_id = '00000000-0000-0000-0000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: admin edited own membership'; end if;

  begin
    update public.business_members set role = 'admin'
     where business_id = test.id('biz') and user_id = '00000000-0000-0000-0000-0000000000a3';
    raise exception 'FAIL: admin promoted staff to admin';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.business_members set role = 'owner'
     where business_id = test.id('biz') and user_id = '00000000-0000-0000-0000-0000000000a3';
    raise exception 'FAIL: admin made someone owner';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Staff without staff.manage can't manage anyone.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
do $$
declare n int;
begin
  delete from public.business_members where business_id = test.id('biz') and role = 'admin';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: staff removed admin'; end if;
  if (select count(*) from public.business_invitations) <> 0 then raise exception 'FAIL: staff sees invitations'; end if;
end $$;

-- Owner can promote staff to admin and remove members.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare n int;
begin
  update public.business_members set role = 'admin'
   where business_id = test.id('biz') and user_id = '00000000-0000-0000-0000-0000000000a3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: owner cannot promote'; end if;

  delete from public.business_members where business_id = test.id('biz') and user_id = '00000000-0000-0000-0000-0000000000a3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: owner cannot remove member'; end if;

  delete from public.business_members where business_id = test.id('biz') and user_id = auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: owner removed themselves'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Inventory ledger + import
-- ---------------------------------------------------------------------------
do $$
declare p uuid; v uuid; r record;
begin
  insert into public.products (business_id, name, price_minor, stock_quantity, sku)
  values (test.id('biz'), 'Loafers', 2500000, 10, 'LOAF-1') returning id into p;
  update public.products set stock_quantity = 7 where id = p;
  insert into public.product_variants (business_id, product_id, name, options, stock_quantity)
  values (test.id('biz'), p, 'Size 42', '{"size":"42"}', 3) returning id into v;

  if (select array_agg(delta order by created_at, delta desc) from public.inventory_movements where product_id = p and variant_id is null) <> array[10, -3] then
    raise exception 'FAIL: product stock ledger %', (select array_agg(delta) from public.inventory_movements where product_id = p);
  end if;
  if (select count(*) from public.inventory_movements where variant_id = v and delta = 3) <> 1 then
    raise exception 'FAIL: variant stock ledger';
  end if;
  -- Once a product has variants, its derived total isn't double-logged.
  update public.products set stock_quantity = 3 where id = p;
  if (select count(*) from public.inventory_movements where product_id = p and variant_id is null) <> 2 then
    raise exception 'FAIL: product total logged although variants exist';
  end if;
  delete from public.product_variants where product_id = p;
  update public.products set stock_quantity = 7 where id = p;
  if exists (select 1 from public.inventory_movements where product_id = p and actor_user_id is distinct from auth.uid()) then
    raise exception 'FAIL: ledger actor not recorded';
  end if;

  -- Stock can't go negative.
  begin
    update public.products set stock_quantity = -1 where id = p;
    raise exception 'FAIL: negative stock';
  exception when check_violation then null;
  end;

  -- Import: 1 update (by SKU) + 2 inserts.
  select * into r from public.import_products(test.id('biz'), '[
    {"name":"Loafers v2","sku":"LOAF-1","price_minor":2600000,"stock_quantity":12},
    {"name":"Sneakers","sku":"SNK-1","price_minor":3000000,"stock_quantity":5,"category":"Sneakers"},
    {"name":"Sandals","price_minor":900000}
  ]'::jsonb);
  if r.inserted <> 2 or r.updated <> 1 then raise exception 'FAIL: import counts % %', r.inserted, r.updated; end if;
  if (select name from public.products where id = p) <> 'Loafers v2' then raise exception 'FAIL: import did not update by sku'; end if;

  -- Import leaves stock of products with variants alone.
  insert into public.product_variants (business_id, product_id, name, stock_quantity)
  select test.id('biz'), id, 'Size 44', 4 from public.products where sku = 'SNK-1';
  update public.products set stock_quantity = 4 where sku = 'SNK-1';
  perform public.import_products(test.id('biz'), '[{"name":"Sneakers","sku":"SNK-1","price_minor":3100000,"stock_quantity":99}]'::jsonb);
  if (select stock_quantity from public.products where sku = 'SNK-1') <> 4 then raise exception 'FAIL: import overwrote variant product stock'; end if;
  if (select price_minor from public.products where sku = 'SNK-1') <> 3100000 then raise exception 'FAIL: import did not update price'; end if;
  if not exists (select 1 from public.inventory_movements where product_id = p and reason = 'import' and delta = 5) then
    raise exception 'FAIL: import ledger reason';
  end if;
end $$;

-- Outsider cannot import into the business.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
begin
  perform public.import_products(test.id('biz'), '[{"name":"Hack","price_minor":1}]'::jsonb);
  raise exception 'FAIL: outsider imported products';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;

-- Client roles have no table privileges on secrets.
reset role;
do $$
begin
  if has_table_privilege('authenticated', 'public.business_credentials', 'select') then
    raise exception 'FAIL: authenticated has select on credentials';
  end if;
end $$;

\echo 'ALL PHASE 2 TESTS PASSED'
rollback;
