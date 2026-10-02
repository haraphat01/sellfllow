-- =============================================================================
-- Business Q&A knowledge base: questions customers ask and the business's own
-- answers. The AI searches these (search_business_faqs) and answers only from
-- what it finds — per business, no model training.
-- =============================================================================

-- array_to_string is only STABLE; keywords are plain text, so this is safe to mark immutable.
create or replace function private.faq_keywords_text(p_keywords text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select coalesce(array_to_string(p_keywords, ' '), '') $$;

create table public.business_faqs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  question text not null check (char_length(question) between 3 and 300),
  answer text not null check (char_length(answer) between 1 and 2000),
  -- Extra search words customers use (local names, Pidgin, misspellings).
  keywords text[] not null default '{}' check (cardinality(keywords) <= 20),
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(question, '')), 'A')
    || setweight(to_tsvector('english', private.faq_keywords_text(keywords)), 'A')
    || setweight(to_tsvector('english', coalesce(answer, '')), 'B')
  ) stored
);

create index business_faqs_business_idx on public.business_faqs (business_id, created_at desc);
create index business_faqs_search_idx on public.business_faqs using gin (search_vector);
create index business_faqs_question_trgm_idx on public.business_faqs using gin (question extensions.gin_trgm_ops);

create trigger business_faqs_updated_at before update on public.business_faqs
  for each row execute function private.set_updated_at();
create trigger business_faqs_business_immutable before update of business_id on public.business_faqs
  for each row execute function private.forbid_business_id_change();

alter table public.business_faqs enable row level security;
create policy business_faqs_select on public.business_faqs for select to authenticated
  using ((select private.is_member(business_id)));
create policy business_faqs_insert on public.business_faqs for insert to authenticated
  with check ((select private.has_perm(business_id, 'settings.manage')));
create policy business_faqs_update on public.business_faqs for update to authenticated
  using ((select private.has_perm(business_id, 'settings.manage')))
  with check ((select private.has_perm(business_id, 'settings.manage')));
create policy business_faqs_delete on public.business_faqs for delete to authenticated
  using ((select private.has_perm(business_id, 'settings.manage')));

-- Ranked search over a business's active Q&As. Words are OR-ed (a customer's
-- question rarely matches every word), English stemming/stop-words apply
-- (deliver ~ delivery), and similar questions match by trigram. RLS applies
-- (security invoker); the AI calls it with the service role.
create or replace function public.search_business_faqs(p_business_id uuid, p_query text, p_limit integer default 3)
returns table (id uuid, question text, answer text, score real)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select
      nullif(trim(left(coalesce(p_query, ''), 300)), '') as text,
      nullif(replace(plainto_tsquery('english', left(coalesce(p_query, ''), 300))::text, '&', '|'), '') as ts_text
  ), q2 as (
    select text, case when ts_text is null then null else to_tsquery('english', ts_text) end as ts from q
  )
  select f.id, f.question, f.answer,
         (coalesce(ts_rank_cd(f.search_vector, q2.ts), 0) + extensions.word_similarity(q2.text, f.question))::real as score
    from public.business_faqs f, q2
   where f.business_id = p_business_id
     and f.is_active
     and q2.text is not null
     and ((q2.ts is not null and f.search_vector @@ q2.ts) or extensions.word_similarity(q2.text, f.question) > 0.35)
   order by score desc, f.updated_at desc
   limit least(greatest(coalesce(p_limit, 3), 1), 10);
$$;

revoke execute on function public.search_business_faqs(uuid, text, integer) from public, anon;
grant execute on function public.search_business_faqs(uuid, text, integer) to authenticated, service_role;
