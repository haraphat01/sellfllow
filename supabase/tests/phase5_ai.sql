-- Phase 5: AI product search. Rolls back.
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'a5@example.com'),
  ('00000000-0000-0000-0000-0000000000d2', 'b5@example.com');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
do $$ begin insert into test.ids values ('a', public.create_business('Aisha Bags')); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
do $$ begin insert into test.ids values ('b', public.create_business('Other Shop')); end $$;
reset role;

insert into public.products (business_id, name, description, price_minor, stock_quantity, category, status) values
  (test.id('a'), 'Black Leather Bag', 'Full-grain leather tote', 4500000, 20, 'Bags', 'active'),
  (test.id('a'), 'Brown Leather Belt', 'Classic belt', 1250000, 35, 'Accessories', 'active'),
  (test.id('a'), 'Secret Draft Bag', 'not launched', 100, 1, 'Bags', 'draft'),
  (test.id('b'), 'Black Leather Bag (competitor)', 'other tenant', 100, 1, 'Bags', 'active');

set local role service_role;
do $$
declare r record; n int;
begin
  select * into r from public.search_products(test.id('a'), 'black bag', 5) limit 1;
  if r.name <> 'Black Leather Bag' then raise exception 'FAIL: search top result %', r.name; end if;

  select count(*) into n from public.search_products(test.id('a'), 'black bag', 5) s where s.name like '%competitor%';
  if n <> 0 then raise exception 'FAIL: search leaked other tenant'; end if;

  select count(*) into n from public.search_products(test.id('a'), 'draft', 5);
  if n <> 0 then raise exception 'FAIL: draft product returned'; end if;

  select * into r from public.search_products(test.id('a'), 'lether belt', 5) limit 1;
  if r.name is distinct from 'Brown Leather Belt' then raise exception 'FAIL: typo search got %', r.name; end if;

  select count(*) into n from public.search_products(test.id('a'), '', 5);
  if n <> 0 then raise exception 'FAIL: empty query returned rows'; end if;

  select count(*) into n from public.search_products(test.id('a'), '%', 5);
  if n <> 0 then raise exception 'FAIL: wildcard query matched everything (%)', n; end if;
end $$;
reset role;

-- A dashboard user passing another tenant's id gets nothing (RLS, security invoker).
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
do $$
begin
  if exists (select 1 from public.search_products(test.id('b'), 'black bag', 5)) then
    raise exception 'FAIL: user searched another tenant';
  end if;
end $$;
reset role;

-- AI conversation quota: counts once per conversation, stops at the limit.
set local role service_role;
do $$
declare c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
begin
  if not public.claim_ai_conversation(test.id('a'), c1, 2) then raise exception 'FAIL: first claim denied'; end if;
  if not public.claim_ai_conversation(test.id('a'), c1, 2) then raise exception 'FAIL: repeat claim denied'; end if;
  if not public.claim_ai_conversation(test.id('a'), c2, 2) then raise exception 'FAIL: second conversation denied'; end if;
  if public.claim_ai_conversation(test.id('a'), c3, 2) then raise exception 'FAIL: over-limit claim allowed'; end if;
  if not public.claim_ai_conversation(test.id('a'), c1, 2) then raise exception 'FAIL: counted conversation denied at limit'; end if;
  if (select quantity from public.usage_records where business_id = test.id('a') and metric = 'monthly_ai_conversations') <> 2 then
    raise exception 'FAIL: usage count wrong';
  end if;
  if not public.claim_ai_conversation(test.id('b'), c3, 2) then raise exception 'FAIL: quota leaked across tenants'; end if;
  if not public.claim_ai_conversation(test.id('a'), gen_random_uuid(), null) then raise exception 'FAIL: unlimited plan denied'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
do $$
begin
  perform public.claim_ai_conversation(test.id('a'), gen_random_uuid(), 1000000);
  raise exception 'FAIL: dashboard user can claim AI quota';
exception when insufficient_privilege then null;
end $$;
reset role;

\echo 'ALL PHASE 5 TESTS PASSED'
rollback;
