-- Business Q&A knowledge base: access rules and search quality. Rolls back.
begin;

create schema test;
grant usage on schema test to authenticated, service_role, anon;
create table test.ids (k text primary key, v uuid not null);
grant select, insert on test.ids to authenticated, service_role, anon;
create function test.id(p_k text) returns uuid language sql stable as $$ select v from test.ids where k = p_k $$;
grant execute on function test.id(text) to authenticated, service_role, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000fa001', 'ownerfaq@example.com'),
  ('00000000-0000-0000-0000-0000000fa002', 'stafffaq@example.com'),
  ('00000000-0000-0000-0000-0000000fa003', 'otherfaq@example.com');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000fa001', true);
do $$ begin insert into test.ids values ('a', public.create_business('Faq A')); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000fa003', true);
do $$ begin insert into test.ids values ('b', public.create_business('Faq B')); end $$;
reset role;
insert into public.business_members (business_id, user_id, role, permissions)
values (test.id('a'), '00000000-0000-0000-0000-0000000fa002', 'staff', '{conversations.view}');

-- The owner manages Q&As through RLS.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000fa001', true);
do $$
begin
  insert into public.business_faqs (business_id, question, answer, keywords) values
    (test.id('a'), 'Do you deliver outside Lagos?', 'Yes — we deliver to Ilorin and Ibadan for ₦2,000, 2–3 days.', '{waybill}'),
    (test.id('a'), 'Can I pick up my order?', 'Yes, pick up from 5 Akata Alanamu, Ilorin, 9am–6pm.', '{pickup,collect}'),
    (test.id('a'), 'Is the parfait halal?', 'Yes, all our ingredients are halal.', '{}');
  insert into public.business_faqs (business_id, question, answer, is_active) values (test.id('a'), 'Old promo?', 'Ended.', false);

  -- Search: stemming (delivery ~ deliver), any word, similar phrasing, keywords; inactive excluded.
  if (select question from public.search_business_faqs(test.id('a'), 'how much is delivery to ilorin', 3) limit 1) <> 'Do you deliver outside Lagos?' then
    raise exception 'FAIL: delivery question not found first';
  end if;
  if (select question from public.search_business_faqs(test.id('a'), 'can i come and collect it myself', 3) limit 1) <> 'Can I pick up my order?' then
    raise exception 'FAIL: keyword "collect" not matched';
  end if;
  if not exists (select 1 from public.search_business_faqs(test.id('a'), 'is it halal', 3) where question = 'Is the parfait halal?') then
    raise exception 'FAIL: halal not found';
  end if;
  if exists (select 1 from public.search_business_faqs(test.id('a'), 'old promo', 5) where question = 'Old promo?') then
    raise exception 'FAIL: inactive Q&A returned';
  end if;
  if exists (select 1 from public.search_business_faqs(test.id('a'), '', 5)) then raise exception 'FAIL: empty query matched'; end if;

  begin
    update public.business_faqs set business_id = test.id('b') where business_id = test.id('a');
    raise exception 'FAIL: business_id changed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- Staff can read (the inbox may show answers) but not change.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000fa002', true);
do $$
begin
  if (select count(*) from public.business_faqs) <> 4 then raise exception 'FAIL: staff cannot read'; end if;
  begin
    insert into public.business_faqs (business_id, question, answer) values (test.id('a'), 'Staff Q?', 'A');
    raise exception 'FAIL: staff inserted';
  exception when insufficient_privilege then null;
  end;
  update public.business_faqs set answer = 'hacked' where business_id = test.id('a');
  if exists (select 1 from public.business_faqs where answer = 'hacked') then raise exception 'FAIL: staff updated'; end if;
end $$;

-- Another business sees and finds nothing, and can't write into A.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000fa003', true);
do $$
begin
  if (select count(*) from public.business_faqs) <> 0 then raise exception 'FAIL: other tenant reads Q&As'; end if;
  if exists (select 1 from public.search_business_faqs(test.id('a'), 'deliver', 5)) then raise exception 'FAIL: other tenant searched Q&As'; end if;
  begin
    insert into public.business_faqs (business_id, question, answer) values (test.id('a'), 'Injected?', 'x');
    raise exception 'FAIL: cross-tenant insert';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo 'ALL BUSINESS FAQ TESTS PASSED'
rollback;
