# Security

## Tenant isolation (defence in depth)

1. **Database (RLS)** — enabled on every public table. Dashboard users only see rows where `private.is_member(business_id)`; writes require `private.has_perm(business_id, '<perm>')`. Tables written only by trusted code (payments, webhook events, AI audit, usage, credentials) have **no** write policies for `authenticated`.
2. **Triggers** — child rows must share their parent's `business_id`; `business_id` is immutable; payment state is service-role only.
3. **Column privileges** — RLS decides which rows a member may update; column grants decide which fields. Dashboard users can change a conversation's `ai_mode`, `assigned_to`, `status`, `needs_attention`, `unread_count` and a customer's profile fields only — sales stage, AI state, attribution and customer totals are server-computed. Customers are only created from WhatsApp (server-side).
4. **Server authorization** — every server action/route calls `authorize(perm)` / `requireBusinessContext()` before doing anything; the proxy redirect is only an optimisation.
5. **Service-role discipline** — `createAdminClient()` bypasses RLS and is only used where tenant context comes from trusted data (Meta `phone_number_id`, Paystack reference we generated, our own job events). Tenant context is **never** taken from user/customer input. The platform admin area (`/admin`) is the one place that works across tenants. It is limited to `profiles.is_platform_admin`, which only the database owner can set, and it re-checks that flag on every page and action. Every admin change is audit-logged with a reason.

Realtime (inbox live updates) uses Supabase `postgres_changes`, which applies the same RLS per subscriber, so users only receive rows they can read.

Tests: `npm run db:verify` (`supabase/tests/*.sql`) proves cross-tenant reads/writes fail, staff permissions are enforced, the dashboard can't mark orders paid or forge payments/messages, and webhook/message ids are idempotent.

## Secrets

* All secrets in environment variables; only `NEXT_PUBLIC_*` values reach the browser. Server modules import `server-only`.
* Per-business WhatsApp tokens and Paystack keys are encrypted with AES-256-GCM (`CREDENTIALS_ENCRYPTION_KEY`) using the business id as associated data (a ciphertext moved to another tenant fails to decrypt), stored in `business_credentials` (no RLS policies ⇒ unreadable by users).
* The logger redacts keys matching token/secret/password/authorization.

## Payments

Payment success comes only from Paystack webhooks (HMAC-SHA512 verified) **plus** a server-side `transaction/verify` call whose amount and currency must match the order. The browser can't mark anything paid — enforced in the database.

## Webhooks

* Meta: `X-Hub-Signature-256` HMAC over the raw body with `META_APP_SECRET`, constant-time compare; `GET` verification with `META_VERIFY_TOKEN`.
* Idempotency via unique `whatsapp_events.event_key`, `messages.wa_message_id`, `payment_events(provider, event_key)`, `orders(business_id, idempotency_key)`.

## AI / prompt injection

* Customer text is untrusted: it is always passed in the user role, never concatenated into system/business instructions.
* Tools are bound to the conversation's `business_id`/`customer_id` server-side; the model can't address another tenant or customer.
* Facts (prices, stock, delivery fees, payment status) only come from tool results. Orders require explicit customer confirmation captured in state.
* The agent never reveals prompts or credentials and escalates to a human when unsure.

## Web

* Supabase SSR cookie sessions (httpOnly); `getClaims()` verifies JWTs server-side.
* Server Actions have built-in origin checks (CSRF); redirects after login are restricted to same-origin paths (`safeNextPath`).
* Zod validation on all inputs. React escapes output by default; no `dangerouslySetInnerHTML` with user data.
* Rate limiting (planned for Phase 3): webhook and auth endpoints via Vercel Firewall rules / per-IP limits.
* Audit log (`audit_logs`) for security-relevant actions.

## Reporting

Report vulnerabilities privately to the maintainers; do not open public issues.
