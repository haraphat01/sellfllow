-- =============================================================================
-- Phase 7: payment state transitions. Only called by the server AFTER it has
-- verified the transaction with Paystack (signed webhook + server-side verify).
-- Service role only.
-- =============================================================================

alter table public.payments
  add column if not exists refund_requested_at timestamptz,
  add column if not exists refunded_amount_minor bigint;

-- Records a verified successful payment and, if the order is still awaiting
-- payment, marks it paid and updates the customer and conversation.
-- Returns {outcome: 'paid' | 'already_paid' | 'order_not_payable', ...}.
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
     set status = 'success', verified_at = now(), paid_at = coalesce(p_paid_at, now()), channel = p_channel,
         provider_transaction_id = p_provider_transaction_id, provider_response = coalesce(p_provider_response, '{}'::jsonb), failure_reason = null
   where id = p_payment_id;

  select * into v_order from public.orders where id = v_pay.order_id for update;
  if v_order.status <> 'pending_payment' then
    insert into public.audit_logs (business_id, actor_type, action, entity_type, entity_id, metadata)
    values (p_business_id, 'webhook', 'payment.received_for_unpayable_order', 'order', v_order.id,
            jsonb_build_object('payment_id', p_payment_id, 'order_status', v_order.status, 'amount_minor', p_amount_minor));
    return jsonb_build_object('outcome', 'order_not_payable', 'order_id', v_order.id, 'order_number', v_order.order_number, 'order_status', v_order.status);
  end if;

  update public.orders set status = 'paid', paid_at = coalesce(p_paid_at, now()) where id = v_order.id;

  select total_orders into v_orders_before from public.customers where id = v_order.customer_id for update;
  update public.customers
     set total_orders = total_orders + 1,
         total_spend_minor = total_spend_minor + v_order.total_minor,
         last_purchase_at = coalesce(p_paid_at, now()),
         status = case when v_orders_before >= 1 then 'repeat_customer'::public.customer_status else 'customer'::public.customer_status end
   where id = v_order.customer_id;

  if v_order.conversation_id is not null then
    update public.conversations
       set sales_outcome = 'purchased', purchase_stage = 'paid', needs_attention = false,
           state = coalesce(state, '{}'::jsonb) || jsonb_build_object('paid_order_number', v_order.order_number)
     where id = v_order.conversation_id;
  end if;

  insert into public.audit_logs (business_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_business_id, 'webhook', 'order.paid', 'order', v_order.id,
          jsonb_build_object('payment_id', p_payment_id, 'amount_minor', p_amount_minor, 'channel', p_channel));

  return jsonb_build_object('outcome', 'paid', 'order_id', v_order.id, 'order_number', v_order.order_number,
                            'customer_id', v_order.customer_id, 'conversation_id', v_order.conversation_id, 'total_minor', v_order.total_minor);
end;
$$;

-- Records a verified non-success outcome (failed/abandoned) unless already paid.
create or replace function public.mark_payment_failed(p_business_id uuid, p_payment_id uuid, p_status public.payment_status, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('failed', 'abandoned') then
    raise exception 'invalid failure status';
  end if;
  update public.payments set status = p_status, failure_reason = left(p_reason, 500)
   where business_id = p_business_id and id = p_payment_id and status in ('initialized', 'pending');
  return found;
end;
$$;

-- Records a verified completed refund: payment + order refunded, customer totals reduced.
create or replace function public.mark_payment_refunded(p_business_id uuid, p_payment_id uuid, p_amount_minor bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_pay from public.payments where business_id = p_business_id and id = p_payment_id for update;
  if not found or v_pay.status = 'refunded' then
    return false;
  end if;
  if v_pay.status <> 'success' then
    raise exception 'only successful payments can be refunded' using errcode = '22023';
  end if;

  update public.payments set status = 'refunded', refunded_at = now(), refunded_amount_minor = coalesce(p_amount_minor, v_pay.amount_minor)
   where id = p_payment_id;

  select * into v_order from public.orders where id = v_pay.order_id for update;
  if v_order.status not in ('refunded', 'cancelled') then
    update public.orders set status = 'refunded' where id = v_order.id;
    if v_order.paid_at is not null then
      update public.customers
         set total_spend_minor = greatest(0, total_spend_minor - coalesce(p_amount_minor, v_pay.amount_minor)),
             total_orders = greatest(0, total_orders - 1)
       where id = v_order.customer_id;
    end if;
  end if;

  insert into public.audit_logs (business_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_business_id, 'webhook', 'order.refunded', 'order', v_order.id,
          jsonb_build_object('payment_id', p_payment_id, 'amount_minor', coalesce(p_amount_minor, v_pay.amount_minor)));
  return true;
end;
$$;

revoke execute on function public.mark_payment_succeeded(uuid, uuid, bigint, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.mark_payment_failed(uuid, uuid, public.payment_status, text) from public, anon, authenticated;
revoke execute on function public.mark_payment_refunded(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.mark_payment_succeeded(uuid, uuid, bigint, text, timestamptz, text, text, jsonb) to service_role;
grant execute on function public.mark_payment_failed(uuid, uuid, public.payment_status, text) to service_role;
grant execute on function public.mark_payment_refunded(uuid, uuid, bigint) to service_role;
