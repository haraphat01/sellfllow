# Database

Postgres on Supabase. Migrations in `supabase/migrations/` are the source of truth.

## Conventions

* UUID primary keys (`gen_random_uuid()`), `timestamptz` everywhere, `created_at`/`updated_at` (trigger-maintained).
* **Money is `bigint` minor units** (`price_minor`, `total_minor` — kobo for NGN). Never floats.
* Every tenant-owned table has `business_id uuid not null references businesses on delete cascade`.
* `business_id` is immutable after insert (trigger on every such table).
* Child rows are forced into their parent's tenant by triggers (`enforce_*_tenant`) — e.g. a message cannot reference another business's conversation, even from the service role.

## Tables

| Domain | Tables |
|---|---|
| Identity & tenancy | `profiles` (users), `businesses`, `business_members` (role + permissions), `permissions`, `business_invitations` |
| Secrets | `business_credentials` (AES-GCM ciphertext; service role only) |
| WhatsApp | `whatsapp_accounts` (**`phone_number_id` unique → business**), `whatsapp_events` (idempotency) |
| CRM | `customers` (unique per `business_id, wa_id`), `customer_tags` |
| Catalogue | `products` (FTS `search_vector` + trigram), `product_variants`, `product_images`, `inventory_movements` (ledger) |
| Conversations | `conversations` (`ai_mode`, `purchase_stage`, `state` jsonb, `sales_outcome`), `messages` (unique `wa_message_id`), `conversation_events` |
| Commerce | `orders` (per-business `order_number`, totals check), `order_items`, `payments` (unique `reference`), `payment_events` |
| AI | `ai_agents`, `ai_settings` (policies, structured delivery zones, follow-up config), `ai_actions`, `ai_usage` |
| Automation | `follow_ups`, `campaigns`, `campaign_recipients` |
| Billing | `subscription_plans` (prices/limits as data), `subscriptions`, `usage_records`, `billing_events` |
| Platform | `audit_logs`, `notifications`, `platform_settings` |

"roles" are the `member_role` enum (`owner`, `admin`, `staff`); owners/admins hold all permissions, staff hold an explicit list.

## Functions

* `create_business(...)` — the only way to create a tenant; makes caller owner, provisions AI defaults and a Starter trial.
* `record_usage(business_id, metric, qty, subject_id?)` — atomic monthly counter, optionally deduped per subject (e.g. one "AI conversation" per conversation per month). Service role only.
* `get_invitation(token)` / `accept_invitation(token)` — invitation lookup and acceptance. Only the SHA-256 of the token is stored; acceptance requires the signed-in user's email to match.
* `import_products(business_id, rows jsonb)` — CSV upsert by SKU, `SECURITY INVOKER` (runs under the caller's RLS).
* `quote_order(business, items, zone)` — prices items from the catalogue and the delivery fee from `ai_settings.delivery_zones`; reports problems (missing variant, stock, unknown zone, product not in this business).
* `create_order(...)` — re-quotes under row locks, reserves stock (ledger `order_reserved`), creates the order + items. Idempotent on `(business_id, idempotency_key)`. All-or-nothing.
* `cancel_order(...)` — unpaid orders only; returns reserved stock (`order_released`); reason recorded in `audit_logs`.
* `expire_stale_orders(interval)` — cancels unpaid orders older than the interval (hourly job, 48h).
  All four are service-role only; the app authorises the user/agent first.
* `mark_payment_succeeded(...)` — after server-side Paystack verification: payment success + order paid + customer totals/status + conversation `purchased`, atomically; amount/currency must match; idempotent; late payments for cancelled orders are recorded and flagged. `mark_payment_failed`, `mark_payment_refunded` likewise. Service role only.
* `follow_up_stop_reason(conversation)` — NULL if a follow-up may be sent, else why not (purchased, opted_out, human_handling, plan, max_reached, …). `schedule_follow_ups(limit)` — cancels stopped follow-ups and schedules one per eligible inactive lead (at most one pending per conversation; none until new activity after the last attempt). `claim_follow_up(...)` — marks a due follow-up sent exactly once before the message goes out. `mark_payment_succeeded` also sets `orders.recovered_by_follow_up_id` (follow-up sent within `attribution_window_hours` before payment) and cancels pending follow-ups. All service-role only.
* `analytics_report(business, from, to)` — all analytics numbers as JSON (definitions in ARCHITECTURE.md). Security definer that checks `analytics.view` (or service role / platform admin) itself. Leads come from `purchase_intent` conversation events written by the `conversations_log_purchase_intent` trigger.
* `private.is_member()`, `private.has_perm()`, `private.is_owner()`, `private.is_platform_admin()` — RLS helpers (security definer, scoped to `auth.uid()`).

## Inventory ledger

Every change to `products.stock_quantity` / `product_variants.stock_quantity` writes an `inventory_movements` row automatically (trigger), with the acting user. Code can label a movement by setting transaction-local `sellflow.stock_reason` (and `sellflow.stock_order_id`) before updating. Products with variants log only at variant level; the product quantity is their derived total.

## Team rules (RLS)

Members with `staff.manage` can invite and edit **staff**. Only the **owner** can grant or manage **admins**. Nobody can modify the owner or their own membership. Permission arrays are validated against `permissions`.

## Integrity guards (triggers)

* Orders are created only by `create_order` (service role). Dashboard users can update `status`, `notes`, `delivery_address`, `customer_name` only (column grants), and the guard lets status move forward only: paid → processing → shipped → delivered.
* `paid`, `refunded`, `cancelled`, totals and attribution are service-role only (verified payment processing / `cancel_order`).
* `is_platform_admin`, business `status`/suspension and `order_seq` can only be changed by the platform.

## Working with migrations

```bash
npm run db:verify     # apply all migrations to a throwaway Postgres 17 + run tenant-isolation tests
supabase db push      # apply to the linked hosted project
npm run db:types      # regenerate src/db/types/database.ts from the linked project
```

New migration: `supabase migration new <name>`, then run `npm run db:verify`. Any new tenant table must: carry `business_id`, enable RLS (the RLS migration does this for tables that exist at that point — new migrations must do it explicitly), add policies, index `business_id`, and add the immutable-`business_id` trigger. Add an isolation assertion to `supabase/tests/rls_tenant_isolation.sql`.
