# SellFlow Architecture

SellFlow is a multi-tenant SaaS: the intelligence, CRM, commerce, payments and
automation layer behind a business's **official** WhatsApp Business Platform
(Cloud API) number. WhatsApp stays the customer channel; SellFlow never scrapes
or automates WhatsApp Web.

## Decisions

| Area | Choice | Why |
|---|---|---|
| App | Next.js 16 App Router (`src/`), TypeScript, Tailwind v4, shadcn/ui, Lucide | One deployable for dashboard + API + webhooks |
| Data | Supabase Postgres + Auth + Storage + Realtime | RLS gives tenant isolation in the database itself |
| Tenancy | Shared schema, `business_id` on every tenant row, RLS | Scales to thousands of tenants with one schema; isolation enforced below the app |
| Jobs | **Inngest** (served from `/api/inngest`) | Durable `step.sleep` for follow-up delays, retries, local dev server, no second deploy target |
| AI | **AI SDK + Vercel AI Gateway** behind `AIProvider` | Swap Anthropic/OpenAI/others by model string; usage/cost observability |
| Payments | Paystack (per-business secret key, encrypted) | Local payment methods; webhooks with HMAC signatures |
| Hosting | Vercel (Fluid Compute, Node.js runtime) + hosted Supabase | |

## Layers

```
src/
├── app/                     # Routes only: pages, layouts, route handlers, server actions
│   ├── (auth)/              # login, signup
│   ├── (app)/               # dashboard shell: dashboard, conversations, orders, products, ...
│   ├── onboarding/          # business creation wizard
│   ├── admin/               # platform admin (is_platform_admin)
│   └── api/                 # webhooks/whatsapp, webhooks/paystack, inngest, health, ...
├── components/              # UI; no business logic
├── lib/                     # cross-cutting: supabase clients, auth context, env, security, logging
├── services/                # domain logic (business, whatsapp, ai, orders, payments, ...)
├── jobs/                    # Inngest functions (follow-ups, campaigns, analytics)
└── db/types/                # generated Database types
supabase/
├── migrations/              # schema, RLS, functions (source of truth)
└── tests/                   # SQL tenant-isolation tests (npm run db:verify)
```

Rules:

* **Components never talk to the database directly** except simple RLS-scoped reads in Server Components. Mutations go through server actions → services.
* **Services take a `DbClient` argument.** The same service works with the user's RLS client (dashboard) or the service-role client (webhooks/jobs). This keeps services extractable into separate workers later.
* **Service-role code must establish tenant context from trusted data** (`phone_number_id`, a verified Paystack reference, an Inngest event created by our own code) and filter every query by that `business_id`.

## Request paths

### Dashboard request

```
Browser → proxy.ts (refresh Supabase session, optimistic auth redirect)
        → Server Component / Server Action
            → requireBusinessContext()/authorize(perm)   (server-side authz)
            → services/*  with user-scoped Supabase client
                → Postgres RLS (is_member / has_perm)    (tenant isolation)
```

The active business is stored in an httpOnly cookie but only honoured if the
user is an active member (checked through RLS on every request).

### Inbound WhatsApp message (Phase 3–5)

```
Meta → POST /api/webhooks/whatsapp
  1. Verify X-Hub-Signature-256 (HMAC-SHA256 of raw body with META_APP_SECRET)
  2. For each change: resolve phone_number_id → whatsapp_accounts → business_id
  3. Insert whatsapp_events(event_key = "msg:<wamid>") — unique ⇒ duplicate deliveries are no-ops
  4. inngest.send("whatsapp/message.received", { event_id })
  5. Return 200 fast (< 1s). No AI work in the request.

Inngest function (per conversation concurrency = 1):
  load event → upsert customer (business_id, wa_id) → find/open conversation
  → insert message (unique wa_message_id) → check plan limits
  → if conversation.ai_mode = AI_ACTIVE and agent enabled: AI Orchestrator
  → send reply via Graph API with the business's decrypted token
  → store outbound message (status queued→sent), status webhooks update it
```

### Payment (Phase 7)

```
AI create_order (after explicit customer confirmation) → orders(pending_payment)
→ Paystack initialize (reference = our payment id) → payments(initialized) → link sent on WhatsApp
Paystack → POST /api/webhooks/paystack
  verify x-paystack-signature (HMAC-SHA512) → payment_events unique(event_key)
  → GET /transaction/verify/:reference (server-side) → amount/currency match?
  → payments.success + orders.paid (service role only; DB trigger blocks anyone else)
  → WhatsApp confirmation → attribution (ai_assisted / recovered_by_follow_up_id)
```

## AI orchestration (Phase 5)

* `AIProvider` interface (`services/ai/provider.ts`); default implementation uses AI SDK + AI Gateway.
* **Prompt layering**: system rules (ours) → business instructions (merchant settings, rendered as data) → trusted app data (tool results) → customer text (always in `user` role, never interpolated into instructions).
* **Tools** are the only source of facts: `search_products`, `get_product`, `check_inventory`, `get_business_policy`, `get_customer`, `get_order`, `calculate_order_total`, `create_order`, `create_payment_link`, `get_payment_status`, `handoff_to_human`. Each tool is constructed with `{ businessId, conversationId, customerId }` bound from the server — the model can't choose a tenant or customer.
* **Structured state** (`conversations.state` + `purchase_stage`) plus a rolling summary and the last N messages replaces sending whole histories.
* Every tool call is written to `ai_actions`, token usage to `ai_usage`.

## Automation (Phase 8)

When the AI records purchase intent, the conversation becomes `sales_outcome = interested_not_purchased`.

```
Inngest cron (every 5 min) → schedule_follow_ups()            [database]
    cancels pending follow-ups that hit a stop condition
    schedules one per eligible lead: last activity + merchant delay
  → one "follow-up/due" event per due follow-up
Inngest "follow-up-send" → processFollowUp()                   [services/automation]
    follow_up_stop_reason() again → activity since? re-time → sending hours? defer
    content from trusted data: unpaid order + payment link, else the recorded
      product (must still be in stock), else a generic check-in
    24h window open → text; closed → approved template, or skip
    claim_follow_up() (at most once) → send via Graph API → conversation event
```

* **Stop conditions** (one SQL definition, `follow_up_stop_reason`): paid, customer replied STOP, human handling/paused AI, conversation closed, automation off, plan without `follow_ups`, max follow-ups for this intent episode.
* A skipped attempt (closed window, out of stock) isn't retried until the conversation has new activity, so nothing loops.
* **Opt-out:** STOP / UNSUBSCRIBE sets `customers.opted_out_at`, cancels pending follow-ups and confirms; START reverses it. Opt-out stops unsolicited messages only — the AI still answers messages the customer sends.
* **Recovered sale** = a paid order whose conversation received a follow-up within `attribution_window_hours` before payment (`orders.recovered_by_follow_up_id`, set atomically by `mark_payment_succeeded`).
* **Sweeper** (every 10 min): WhatsApp events left `received`/`failed`, or stuck `processing` for 15 min, within the last 24h, are re-queued (processing is idempotent).

## Analytics (Phase 9)

One database function, `analytics_report(business, from, to)`, computes every number (Overview, Analytics and Automation pages share it), with daily buckets in the business's time zone. It checks `analytics.view` itself because it reads tables other permissions guard. Aggregation runs on indexed queries at request time; a rollup job can be added if tenants grow large.

| Metric | Rule |
|---|---|
| Revenue | Orders whose payment Paystack verified in the period (by `paid_at`), excluding refunded orders |
| Lead | A `purchase_intent` conversation event, logged by trigger whenever `sales_outcome` becomes `interested_not_purchased` |
| Conversion rate | Leads in the period that later paid for an order in the same conversation ÷ leads |
| AI-assisted sale | Paid order created by the AI in chat after the customer confirmed (`orders.ai_assisted`); staff-created orders never count |
| Recovered sale | Paid order with `recovered_by_follow_up_id` (follow-up sent within the attribution window before payment) |
| Conversations | Conversations with an inbound message in the period ("new" = created in the period) |

Starter shows the KPI cards; Growth and above (`advanced_analytics`) add daily trends, previous-period comparison, the funnel and top products.

## Platform admin (Phase 11)

`/admin` is for SellFlow staff (`profiles.is_platform_admin`). Only the database owner can set that flag; a trigger blocks everyone else. Grant it in the Supabase SQL editor:

```sql
update public.profiles set is_platform_admin = true where email = 'you@example.com';
```

* Every page calls `requirePlatformAdmin()`. Every action calls `authorizePlatformAdmin()` and then uses the service role. Every change is written to `audit_logs` with `actor_type = 'admin'` and a required reason.
* **Overview:** `admin_platform_stats()`, which only the service role can run. It covers:
  * MRR: paying `active`/`past_due` subscriptions, with annual plans divided by 12 and complimentary plans excluded.
  * SellFlow revenue: paid invoices.
  * Churn: paying subscriptions that were cancelled or expired, taken from the `subscription.*` billing events; unconverted trials are counted separately.
  * Messages, AI conversations, orders and merchant payment volume.
  * Failures, and WhatsApp number health.
* **Suspend:** the dashboard becomes read-only for the team (`authorize()` refuses changes), and the AI, follow-ups and renewal charges stop. Inbound messages are still stored, and the owner is notified.
* **Grant plan:** complimentary, not counted as revenue, and ends at the period end. It voids any open checkouts; a real payment later clears the flag.
* **Extend trial:** only for businesses that aren't on a paid or granted plan.
* **Plans:** price, limits and features are editable. The code is fixed, and a plan can be hidden or retired but never deleted. Members can always read their own plan, even after it's hidden.

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Foundation: Next.js, Supabase, auth, full schema, multi-tenancy, RLS, dashboard shell | **Done** |
| 2 | Onboarding: business profile, team members & invitations, product catalogue, variants, images, inventory ledger, CSV import | **Done** |
| 3 | WhatsApp: Embedded Signup, webhook verify, inbound/outbound, message storage | **Done** (live Meta connection pending credentials) |
| 4 | Inbox: conversations, customer profiles, human replies, AI pause/resume, realtime | **Done** |
| 5 | AI: provider abstraction, sales agent, tools, handoff | **Done** (real-model evals pending an AI Gateway key) |
| 6 | Orders: AI quoting + confirmed ordering, atomic stock reservation, cancel/expiry, order management | **Done** |
| 7 | Paystack: merchant keys, payment links, verified webhooks, WhatsApp confirmation, refunds | **Done** |
| 8 | Automation: abandoned-lead detection, follow-ups, STOP/START consent, recovery attribution, event sweeper | **Done** |
| 9 | Analytics & attribution: revenue, leads, conversion, AI-assisted & recovered sales, trends, funnel, top products | **Done** |
| 10 | Billing: Paystack checkout, saved-card renewals, upgrades/downgrades/cancel, grace period, usage limits & alerts | **Done** |
| 11 | Admin: platform metrics, business search/detail, suspend/reinstate, complimentary plans & trial extensions, plan/price editor, trial settings, audit & failure logs | **Done** |
