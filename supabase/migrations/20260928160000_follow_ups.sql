-- =============================================================================
-- Phase 8: abandoned-lead recovery (follow-ups).
--
--   schedule_follow_ups()  every few minutes (Inngest cron): cancels scheduled
--                          follow-ups whose conversation hit a stop condition and
--                          schedules one for each eligible conversation.
--   follow_up_stop_reason() the single definition of "may we follow up?", used
--                          by the scheduler and again right before sending.
--   mark_payment_succeeded  now attributes recovered sales to the follow-up.
--
-- Sending (message content, 24h window, business hours) happens in the app.
-- Service role only.
-- =============================================================================

alter table public.ai_settings
  add column if not exists follow_up_window_start smallint not null default 9 check (follow_up_window_start between 0 and 23),
  add column if not exists follow_up_window_end smallint not null default 20 check (follow_up_window_end between 1 and 24),
  add column if not exists follow_up_template_language text not null default 'en' check (char_length(follow_up_template_language) between 2 and 10);

alter table public.ai_settings
  add constraint ai_settings_follow_up_window_check check (follow_up_window_start < follow_up_window_end);

-- A conversation can have several intent episodes (buy, come back later, buy
-- again), so sequence numbers repeat. At most one follow-up is pending at a time.
alter table public.follow_ups drop constraint if exists follow_ups_conversation_id_sequence_number_key;
create unique index follow_ups_one_scheduled_idx on public.follow_ups (conversation_id) where status = 'scheduled';
create index follow_ups_conversation_idx on public.follow_ups (conversation_id, created_at desc);

alter table public.follow_ups
  add column if not exists channel text check (channel in ('text', 'template')),
  add column if not exists order_id uuid references public.orders (id) on delete set null;

-- Follow-ups sent in the current intent episode (since the conversation's last paid order).
create or replace function private.follow_ups_sent_in_episode(p_conversation_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.follow_ups f
   where f.conversation_id = p_conversation_id
     and f.status = 'sent'
     and f.sent_at > coalesce((select max(o.paid_at) from public.orders o where o.conversation_id = p_conversation_id), '-infinity'::timestamptz);
$$;

-- NULL = a follow-up may be sent; otherwise why not.
create or replace function public.follow_up_stop_reason(p_conversation_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c record;
begin
  select conv.status, conv.ai_mode, conv.sales_outcome, conv.whatsapp_account_id,
         cu.opted_out_at, b.status as business_status,
         s.follow_up_enabled, s.follow_up_max,
         sub.status as sub_status, coalesce((pl.features ->> 'follow_ups')::boolean, false) as plan_allows
    into c
    from public.conversations conv
    join public.customers cu on cu.id = conv.customer_id
    join public.businesses b on b.id = conv.business_id
    left join public.ai_settings s on s.business_id = conv.business_id
    left join public.subscriptions sub on sub.business_id = conv.business_id
    left join public.subscription_plans pl on pl.id = sub.plan_id
   where conv.id = p_conversation_id;

  if not found then return 'not_found'; end if;
  if c.business_status <> 'active' then return 'business_inactive'; end if;
  if not coalesce(c.follow_up_enabled, false) then return 'automation_disabled'; end if;
  if c.sub_status is null or c.sub_status not in ('active', 'trialing') or not c.plan_allows then return 'plan'; end if;
  if c.sales_outcome = 'purchased' then return 'purchased'; end if;
  if c.sales_outcome <> 'interested_not_purchased' then return 'no_purchase_intent'; end if;
  if c.opted_out_at is not null then return 'opted_out'; end if;
  if c.status <> 'open' then return 'conversation_closed'; end if;
  if c.ai_mode <> 'AI_ACTIVE' then return 'human_handling'; end if;
  if c.whatsapp_account_id is null then return 'no_whatsapp_number'; end if;
  if private.follow_ups_sent_in_episode(p_conversation_id) >= coalesce(c.follow_up_max, 0) then return 'max_reached'; end if;
  return null;
end;
$$;

-- Cancels pending follow-ups that hit a stop condition, then schedules the next
-- follow-up for each eligible, inactive-enough lead. Nothing is re-scheduled
-- until the conversation has new activity after the last attempt, so a skipped
-- follow-up (closed 24h window, out of stock) doesn't loop.
-- Returns {cancelled, scheduled}.
create or replace function public.schedule_follow_ups(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cancelled integer;
  v_scheduled integer;
begin
  with stopped as (
    select f.id, public.follow_up_stop_reason(f.conversation_id) as reason
      from public.follow_ups f
     where f.status = 'scheduled'
  )
  update public.follow_ups f
     set status = 'cancelled', cancel_reason = stopped.reason
    from stopped
   where f.id = stopped.id and stopped.reason is not null;
  get diagnostics v_cancelled = row_count;

  with candidates as (
    select c.id, c.business_id, c.customer_id,
           greatest(coalesce(c.last_message_at, c.created_at), coalesce(c.purchase_intent_at, c.created_at))
             + make_interval(mins => s.follow_up_delay_minutes) as due_at
      from public.conversations c
      join public.ai_settings s on s.business_id = c.business_id and s.follow_up_enabled
     where c.sales_outcome = 'interested_not_purchased'
       and c.status = 'open'
       and not exists (
         select 1 from public.follow_ups f
          where f.conversation_id = c.id
            and (f.status = 'scheduled' or f.created_at > coalesce(c.last_message_at, c.created_at))
       )
       and public.follow_up_stop_reason(c.id) is null
     order by c.last_message_at nulls first
     limit p_limit
  )
  insert into public.follow_ups (business_id, conversation_id, customer_id, sequence_number, scheduled_for)
  select cand.business_id, cand.id, cand.customer_id, private.follow_ups_sent_in_episode(cand.id) + 1, cand.due_at
    from candidates cand
  on conflict (conversation_id) where status = 'scheduled' do nothing;
  get diagnostics v_scheduled = row_count;

  return jsonb_build_object('cancelled', v_cancelled, 'scheduled', v_scheduled);
end;
$$;

-- Atomically claims a due follow-up for sending (at most once). Returns false if
-- it was already claimed, cancelled or rescheduled.
create or replace function public.claim_follow_up(p_follow_up_id uuid, p_message text, p_channel text, p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.follow_ups
     set status = 'sent', sent_at = now(), message = left(p_message, 4096), channel = p_channel, order_id = p_order_id
   where id = p_follow_up_id and status = 'scheduled' and scheduled_for <= now();
  return found;
end;
$$;

-- -----------------------------------------------------------------------------
-- Payment success now also cancels pending follow-ups and records recovery
-- attribution: the most recent follow-up sent in this conversation within the
-- business's attribution window before payment.
-- -----------------------------------------------------------------------------
create or replace function public.mark_payment_succeeded(
  p_business_id uuid,
  p_payment_id uuid,
  p_amount_minor bigint,
  p_currency text,
  p_paid_at timestamptz,
  p_channel text,
  p_provider_transaction_id text,
  p_provider_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_order public.orders%rowtype;
  v_orders_before integer;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
  v_follow_up uuid;
begin
  select * into v_pay from public.payments where business_id = p_business_id and id = p_payment_id for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if v_pay.status = 'success' then
    return jsonb_build_object('outcome', 'already_paid', 'order_id', v_pay.order_id);
  end if;
  if p_amount_minor <> v_pay.amount_minor or upper(p_currency) <> v_pay.currency then
    raise exception 'amount mismatch: expected % %, got % %', v_pay.amount_minor, v_pay.currency, p_amount_minor, upper(p_currency) using errcode = '22023';
  end if;

  update public.payments
     set status = 'success', verified_at = now(), paid_at = v_paid_at, channel = p_channel,
         provider_transaction_id = p_provider_transaction_id, provider_response = coalesce(p_provider_response, '{}'::jsonb), failure_reason = null
   where id = p_payment_id;

  select * into v_order from public.orders where id = v_pay.order_id for update;
  if v_order.status <> 'pending_payment' then
    insert into public.audit_logs (business_id, actor_type, action, entity_type, entity_id, metadata)
    values (p_business_id, 'webhook', 'payment.received_for_unpayable_order', 'order', v_order.id,
            jsonb_build_object('payment_id', p_payment_id, 'order_status', v_order.status, 'amount_minor', p_amount_minor));
    return jsonb_build_object('outcome', 'order_not_payable', 'order_id', v_order.id, 'order_number', v_order.order_number, 'order_status', v_order.status);
  end if;

  if v_order.conversation_id is not null then
    select f.id into v_follow_up
      from public.follow_ups f
      join public.ai_settings s on s.business_id = f.business_id
     where f.business_id = p_business_id
       and f.conversation_id = v_order.conversation_id
       and f.status = 'sent'
       and f.sent_at <= v_paid_at
       and f.sent_at >= v_paid_at - make_interval(hours => s.attribution_window_hours)
     order by f.sent_at desc
     limit 1;
  end if;

  update public.orders set status = 'paid', paid_at = v_paid_at, recovered_by_follow_up_id = v_follow_up where id = v_order.id;

  select total_orders into v_orders_before from public.customers where id = v_order.customer_id for update;
  update public.customers
     set total_orders = total_orders + 1,
         total_spend_minor = total_spend_minor + v_order.total_minor,
         last_purchase_at = v_paid_at,
         status = case when v_orders_before >= 1 then 'repeat_customer'::public.customer_status else 'customer'::public.customer_status end
   where id = v_order.customer_id;

  if v_order.conversation_id is not null then
    update public.conversations
       set sales_outcome = 'purchased', purchase_stage = 'paid', needs_attention = false,
           state = coalesce(state, '{}'::jsonb) || jsonb_build_object('paid_order_number', v_order.order_number)
     where id = v_order.conversation_id;
    update public.follow_ups set status = 'cancelled', cancel_reason = 'purchased'
     where conversation_id = v_order.conversation_id and status = 'scheduled';
  end if;

  insert into public.audit_logs (business_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_business_id, 'webhook', 'order.paid', 'order', v_order.id,
          jsonb_build_object('payment_id', p_payment_id, 'amount_minor', p_amount_minor, 'channel', p_channel, 'recovered_by_follow_up_id', v_follow_up));

  return jsonb_build_object('outcome', 'paid', 'order_id', v_order.id, 'order_number', v_order.order_number,
                            'customer_id', v_order.customer_id, 'conversation_id', v_order.conversation_id, 'total_minor', v_order.total_minor,
                            'recovered_by_follow_up_id', v_follow_up);
end;
$$;

revoke execute on function private.follow_ups_sent_in_episode(uuid) from public, anon, authenticated;
revoke execute on function public.follow_up_stop_reason(uuid) from public, anon, authenticated;
revoke execute on function public.schedule_follow_ups(integer) from public, anon, authenticated;
revoke execute on function public.claim_follow_up(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.follow_up_stop_reason(uuid) to service_role;
grant execute on function public.schedule_follow_ups(integer) to service_role;
grant execute on function public.claim_follow_up(uuid, text, text, uuid) to service_role;
