-- Atomic "may the AI handle this conversation this month?" check.
-- A conversation counts once per calendar month (UTC). Returns true if it is
-- already counted or there is room under p_limit (then counts it). Service role only.
create or replace function public.claim_ai_conversation(p_business_id uuid, p_conversation_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', now() at time zone 'UTC')::date;
  v_used bigint;
begin
  if exists (
    select 1 from private.usage_subjects
    where business_id = p_business_id and metric = 'monthly_ai_conversations'
      and period_start = v_period and subject_id = p_conversation_id::text
  ) then
    return true;
  end if;

  -- Serialise claims per business+month so concurrent conversations can't overshoot.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':ai:' || v_period::text, 0));

  select coalesce(quantity, 0) into v_used from public.usage_records
   where business_id = p_business_id and metric = 'monthly_ai_conversations' and period_start = v_period;

  if p_limit is not null and coalesce(v_used, 0) >= p_limit then
    return false;
  end if;

  perform public.record_usage(p_business_id, 'monthly_ai_conversations', 1, p_conversation_id::text);
  return true;
end;
$$;

revoke execute on function public.claim_ai_conversation(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_conversation(uuid, uuid, integer) to service_role;
