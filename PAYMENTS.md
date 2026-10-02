# Payments (Paystack)

> Every merchant is paid to their **bank account**: it becomes a Paystack
> subaccount of SellFlow's platform account (`PAYSTACK_SECRET_KEY`), customer
> payments are split to it, and Paystack settles straight to the merchant's
> bank — SellFlow never holds the money. See "Bank-account payouts" below.
> Merchants can no longer connect their own Paystack key; payments made that
> way earlier (`collection_mode = 'merchant_key'`) still verify, refund and
> receive webhooks with the stored key. SellFlow's own subscription billing
> uses the same platform key (Phase 10).

## Code map

| Piece | File |
|---|---|
| Paystack API client (initialize, verify, refund, key check) | `src/lib/paystack/client.ts` |
| Webhook signature (HMAC-SHA512) | `src/lib/paystack/signature.ts` |
| Connect key, payment links, confirm, webhooks, refunds | `src/services/payments/payments.service.ts` |
| Webhook route | `src/app/api/webhooks/paystack/route.ts` |
| Customer confirmation / unpayable-order jobs | `src/jobs/payments/notify.ts` |
| State transitions (service role only) | `mark_payment_succeeded`, `mark_payment_failed`, `mark_payment_refunded` (`supabase/migrations/20260928150000_payments.sql`) |
| Merchant UI | Settings → Payments; order page "Payment" card |

## Setup

* **Platform (once):** set `PAYSTACK_SECRET_KEY` to SellFlow's Paystack key, set that account's webhook to `https://<your-domain>/api/webhooks/paystack/billing` (or `/api/webhooks/paystack`; both accept everything), and ask Paystack to enable split payments / subaccounts.
* **Each merchant:** Settings → Payments → choose bank, enter account number → **Verify account** → confirm the name → **Use this account** (owner only).

Locally, webhooks can't reach `localhost` — use a tunnel, or rely on **Check payment** (order page) / the AI's `get_payment_status`, which ask Paystack directly.

## Flow

```
AI create_order (after customer confirmation) → create_payment_link
  → payments row (reference sf-<order>-<random>) → POST /transaction/initialize
  → checkout link sent on WhatsApp (existing open link for the same amount is reused)
Customer pays on Paystack's checkout
Paystack → POST /api/webhooks/paystack
  1. find payment by data.reference → its business → that business's secret key
  2. verify x-paystack-signature = HMAC-SHA512(raw body, secret key)   (401 if not)
  3. payment_events(provider, event_key) — duplicates stop here
  4. charge.success → GET /transaction/verify/:reference  (the event itself is never trusted)
  5. status success + amount + currency match → mark_payment_succeeded (one transaction):
       payment success · order paid · customer totals/status · conversation purchased
  6. Inngest payment/succeeded → WhatsApp "✅ Payment received for order #N"
```

* **Never trusted:** the browser return page (`/pay/complete` only says "we're confirming"), webhook bodies, the AI, or the customer saying "I've paid". Paid status comes only from Paystack's verify API.
* **Forged or early events:** a correctly signed `charge.success` for a transaction Paystack reports as `abandoned` changes nothing.
* **Amount/currency mismatch:** rejected; the event is marked failed for investigation.
* **Late payment for a cancelled/expired order:** payment recorded, order untouched, the team is notified to fulfil or refund.
* **Refunds:** order page → Refund (owners/admins) → `POST /refund`; the order becomes Refunded when `refund.processed` arrives. Stock isn't returned automatically.
* Customers without an email get `<wa_id>@<PAYSTACK_PLACEHOLDER_EMAIL_DOMAIN>` (Paystack requires an email).

## Testing

* `npm test` — signature verification.
* `npm run db:verify` — `supabase/tests/phase7_payments.sql` (atomic transitions, idempotency, mismatches, refunds, late payments, dashboard can't call them).
* `npm run test:integration` with `PAYSTACK_BASE_URL=http://127.0.0.1:8298` and `node scripts/mock-paystack.mjs` — full webhook path through the running app, including the AI sending the link and refusing to confirm before Paystack does.
* Real test payments: Paystack's test cards on the test checkout page (see Paystack's docs), then **Check payment**.

---

# Bank-account payouts

The only way merchants are paid. They enter a **bank account** (Settings → Payments, owner only), and no Paystack account is needed.

```
Owner picks bank + 10-digit account → Paystack account lookup (name shown, owner confirms)
  → re-checked server-side → Paystack subaccount on SellFlow's platform account
Payment link: initialised with PAYSTACK_SECRET_KEY + subaccount
  + transaction_charge (SellFlow fee) + bearer = subaccount (Paystack's fee from the merchant's share)
Customer pays → Paystack settles the merchant's share straight to their bank (T+1)
Webhook (platform account) → verified with the platform key → same paid flow as above
```

* **Which key a payment uses:** every new payment is `platform_subaccount`. The `collection_mode` stored on each payment decides which key verifies it, refunds it and signs its webhooks, so legacy `merchant_key` payments keep working.
* **SellFlow never holds merchant money:** Paystack settles subaccounts directly. Refunds and chargebacks on these payments go through SellFlow's Paystack account, so reconcile them there.
* **Fee:** `/admin/settings`, a percentage plus a flat fee, stored in `platform_settings.payments`. It applies to new payment links and is recorded per payment (`platform_fee_minor`). Merchants see the fee on their Payments page.
* **Stored:** bank, last 4 digits, the account name Paystack returned, and the subaccount code. **Never the full account number.**
* **Fraud controls:**
  * Only the owner can set or change the account.
  * Name lookups are limited to 20 per hour per business and logged.
  * Every change is audit-logged and the team is notified.
  * Admins see the payout account on the business page.
* **Webhooks:** Paystack sends all of the platform account's events to one URL. Both `/api/webhooks/paystack` and `/api/webhooks/paystack/billing` accept every event (`sfb-…` references go to billing, the rest are order payments). Set the platform account's webhook to either.
* **Before going live:** ask Paystack to enable split payments / subaccounts for SellFlow's account. You're responsible for the merchants you onboard (identity checks, disputes). Get Paystack's and a Nigerian fintech lawyer's confirmation of your obligations. In test mode, Paystack's account lookup only works with its test banks and accounts.

Code: `src/services/payments/payouts.service.ts`, `payouts.core.ts`; migration `20260930120000_payout_accounts.sql`; tests `supabase/tests/payouts.sql`, `tests/unit/payouts.test.ts`, `tests/integration/payouts.int.test.ts` (starts its own mock Paystack).

---

# SellFlow subscription billing (Phase 10)

Merchants pay **SellFlow** with SellFlow's own Paystack account (`PAYSTACK_SECRET_KEY`). Merchants' customer payments use the same account but are split to their subaccounts; subscription invoices use `sfb-` references and are never split.

| Piece | File |
|---|---|
| Rules (plan change type, proration, retry schedule) | `src/services/billing/billing.core.ts` |
| Checkout, verification, webhook, renewals, alerts | `src/services/billing/billing.service.ts` |
| Limits and usage | `src/services/billing/limits.ts` |
| State transitions (service role only) | `apply_billing_payment`, `mark_renewal_failed`, `advance_subscription_states`, `set_subscription_schedule` (`supabase/migrations/20260928180000_billing_engine.sql`) |
| Webhook | `/api/webhooks/paystack/billing` (signed with `PAYSTACK_SECRET_KEY`) |
| Return page | `/billing/complete` (verifies server-side; the query string proves nothing) |
| Hourly job | `billing-lifecycle`: renewals → expiries → usage alerts |

## Rules

* **Every charge is a `billing_invoices` row** (`subscribe`, `upgrade`, `renewal`, reference `sfb-…`). A plan changes only in `apply_billing_payment`, after Paystack's verify API confirms the amount and currency. Replays are no-ops. If two checkouts are open, the first one paid wins and the other is voided; if the voided one is paid too, it's flagged for a refund.
* **Trial → plan:** full price. The period starts at payment.
* **Upgrade:** immediate. Charges the price difference for the rest of the period, rounded up to whole naira, minimum ₦100. Uses the saved card if there is one, otherwise checkout. The period end doesn't change.
* **Downgrade:** takes effect at the next renewal, with no charge now. It can be undone until then.
* **Cancel:** at period end, and can be undone until then. After that the subscription is `cancelled`.
* **Renewal:** the hourly job charges the saved card (Paystack `charge_authorization`) for the next period, at the scheduled plan.
  * Declined, or no saved card → `past_due`, a payment link, and a notification. It retries daily, up to 3 attempts.
  * `past_due` keeps working for a **3-day grace period**, then the subscription becomes `expired`.
* **Saved card:** stored only as an encrypted Paystack authorization code (`business_credentials`, label `billing_authorization`). The dashboard shows brand, last 4 digits and expiry, and it can be removed.
* **Usable statuses:** `trialing`, `active`, `past_due`.
  * `expired` / `cancelled`: the AI and automations stop.
  * Inbound messages are still stored, and staff can still reply by hand.

## Limits (per plan, data in `subscription_plans.limits`)

| Limit | Enforced where | When reached |
|---|---|---|
| AI conversations / month | before each AI turn (`claim_ai_conversation`) | handed to the team |
| Messages / month | before AI replies and follow-ups | handed to the team; follow-ups skipped |
| Orders / month | AI `create_order` | AI hands off; team can still create orders |
| Customers | AI turn (customers beyond the limit, by sign-up order) | handed to the team |
| Products, team members, WhatsApp numbers | when adding them | blocked with an upgrade message |

The owner is notified at 80% and 100% of each monthly allowance (hourly job, once per level per month). There is also an app-wide banner when the trial ends within 3 days, a payment is due, or the plan has ended.

## Testing

* `npm test`: proration, plan-change classification, month arithmetic, alert levels.
* `npm run db:verify`: `supabase/tests/phase10_billing.sql` (transitions, idempotency, voided checkouts, grace/trial/cancel expiry, invoice access).
* `npm run test:integration` with the mock Paystack: trial → checkout → signed webhook, upgrade on the saved card, downgrade at renewal, declined renewal → past due → pay link, and cancel.
