-- =============================================================================
-- Phase 9: analytics & attribution.
--
-- Definitions (also shown in the app, see ANALYTICS in README/AI.md):
--   Revenue          sum of paid orders (verified by Paystack) in the period,
--                    by paid_at, excluding orders later refunded.
--   Lead             a conversation whose sales outcome became
--                    "interested, not purchased" (the AI recorded purchase
--                    intent). Logged as a `purchase_intent` conversation event.
--   Conversion rate  leads in the period that went on to pay for an order in
--                    that conversation (any time after the intent) / leads.
--   AI-assisted sale paid order the AI created in the chat after the customer
--                    confirmed (orders.ai_assisted).
--   Recovered sale   paid order whose conversation got an automated follow-up
--                    within the attribution window before payment
--                    (orders.recovered_by_follow_up_id).
-- =============================================================================

-- Purchase-intent history: sales_outcome only holds the latest state.
create or replace function private.log_purchase_intent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sales_outcome = 'interested_not_purchased'
     and (tg_op = 'INSERT' or old.sales_outcome is distinct from new.sales_outcome) then
    insert into public.conversation_events (business_id, conversation_id, type, actor_type, data)
    values (new.business_id, new.id, 'purchase_intent', 'system',
            jsonb_build_object('stage', new.purchase_stage, 'product_id', new.state ->> 'product_id'));
  end if;
  return new;
end;
$$;

create trigger conversations_log_purchase_intent
  after insert or update of sales_outcome on public.conversations
  for each row execute function private.log_purchase_intent();

-- Backfill leads recorded before this migration.
insert into public.conversation_events (business_id, conversation_id, type, actor_type, data, created_at)
select c.business_id, c.id, 'purchase_intent', 'system', jsonb_build_object('backfilled', true), c.purchase_intent_at
  from public.conversations c
 where c.purchase_intent_at is not null
   and c.sales_outcome in ('interested_not_purchased', 'purchased')
   and not exists (select 1 from public.conversation_events e where e.conversation_id = c.id and e.type = 'purchase_intent');

create index if not exists orders_business_paid_idx on public.orders (business_id, paid_at) where paid_at is not null;
create index if not exists conversation_events_business_type_idx on public.conversation_events (business_id, type, created_at);
create index if not exists conversations_business_created_idx on public.conversations (business_id, created_at);

-- One report for [p_from, p_to). Daily buckets use the business's time zone.
-- Callable by members with analytics.view (checked here: it reads across
-- tables that other permissions guard), the service role and platform admins.
create or replace function public.analytics_report(p_business_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_currency text;
  v_result jsonb;
begin
  -- (current_user is the function owner here, so only the JWT role and membership count.)
  if not (coalesce(auth.role(), '') = 'service_role'
          or private.has_perm(p_business_id, 'analytics.view')
          or private.is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  select timezone, currency into v_tz, v_currency from public.businesses where id = p_business_id;
  if v_tz is null then
    raise exception 'business not found' using errcode = 'P0002';
  end if;

  with
  paid as (
    select o.id, o.total_minor, o.paid_at, o.status, o.ai_assisted, o.recovered_by_follow_up_id, o.conversation_id
      from public.orders o
     where o.business_id = p_business_id and o.paid_at >= p_from and o.paid_at < p_to
  ),
  net as (select * from paid where status <> 'refunded'),
  leads as (
    select e.conversation_id, min(e.created_at) as intent_at
      from public.conversation_events e
     where e.business_id = p_business_id and e.type = 'purchase_intent' and e.created_at >= p_from and e.created_at < p_to
     group by e.conversation_id
  ),
  converted as (
    select count(*) as n
      from leads l
     where exists (select 1 from public.orders o
                    where o.business_id = p_business_id and o.conversation_id = l.conversation_id
                      and o.paid_at is not null and o.paid_at >= l.intent_at)
  ),
  convs as (
    select c.id, c.created_at from public.conversations c
     where c.business_id = p_business_id and c.created_at >= p_from and c.created_at < p_to
  ),
  active as (
    select count(distinct m.conversation_id) as n
      from public.messages m
     where m.business_id = p_business_id and m.direction = 'inbound' and m.created_at >= p_from and m.created_at < p_to
  ),
  ai_convs as (
    select count(distinct m.conversation_id) as n
      from public.messages m
     where m.business_id = p_business_id and m.sender = 'ai' and m.created_at >= p_from and m.created_at < p_to
  ),
  created as (
    select count(*) as n from public.orders o
     where o.business_id = p_business_id and o.created_at >= p_from and o.created_at < p_to and o.status <> 'draft'
  ),
  fus as (
    select count(*) filter (where f.status = 'sent') as sent
      from public.follow_ups f
     where f.business_id = p_business_id and f.sent_at >= p_from and f.sent_at < p_to
  ),
  handoffs as (
    select count(*) as n from public.conversation_events e
     where e.business_id = p_business_id and e.type = 'handoff_requested' and e.created_at >= p_from and e.created_at < p_to
  ),
  days as (
    select d::date as day
      from generate_series((p_from at time zone v_tz)::date, ((p_to - interval '1 microsecond') at time zone v_tz)::date, interval '1 day') d
  ),
  daily as (
    select dd.day,
           coalesce((select sum(n.total_minor) from net n where (n.paid_at at time zone v_tz)::date = dd.day), 0) as revenue_minor,
           (select count(*) from net n where (n.paid_at at time zone v_tz)::date = dd.day) as orders,
           (select count(*) from convs c where (c.created_at at time zone v_tz)::date = dd.day) as conversations,
           (select count(*) from leads l where (l.intent_at at time zone v_tz)::date = dd.day) as leads
      from days dd
  ),
  top as (
    select coalesce(i.product_id::text, i.name) as key, max(i.name) as name, sum(i.quantity) as quantity, sum(i.total_minor) as revenue_minor
      from public.order_items i
      join net n on n.id = i.order_id
     group by 1
     order by 4 desc, 3 desc
     limit 5
  )
  select jsonb_build_object(
    'currency', v_currency,
    'timezone', v_tz,
    'from', p_from,
    'to', p_to,
    'revenue_minor', coalesce((select sum(total_minor) from net), 0),
    'orders_paid', (select count(*) from net),
    'refunded_minor', coalesce((select sum(total_minor) from paid where status = 'refunded'), 0),
    'orders_created', (select n from created),
    'conversations_new', (select count(*) from convs),
    'conversations_active', (select n from active),
    'ai_conversations', (select n from ai_convs),
    'handoffs', (select n from handoffs),
    'leads', (select count(*) from leads),
    'leads_converted', (select n from converted),
    'ai_assisted_orders', (select count(*) from net where ai_assisted),
    'ai_assisted_revenue_minor', coalesce((select sum(total_minor) from net where ai_assisted), 0),
    'recovered_orders', (select count(*) from net where recovered_by_follow_up_id is not null),
    'recovered_revenue_minor', coalesce((select sum(total_minor) from net where recovered_by_follow_up_id is not null), 0),
    'follow_ups_sent', (select sent from fus),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'revenue_minor', revenue_minor, 'orders', orders, 'conversations', conversations, 'leads', leads) order by day) from daily), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'revenue_minor', revenue_minor) order by revenue_minor desc, quantity desc) from top), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.analytics_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_report(uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke execute on function private.log_purchase_intent() from public, anon, authenticated;
