# WhatsApp (Meta WhatsApp Business Platform / Cloud API)

> Status: implemented (Phase 3) — Embedded Signup (v4), manual token connection,
> webhook verification + signature checks, idempotent storage, background
> processing (in-process background jobs), outbound text/template sending, delivery statuses.
> Verified end-to-end with signed test payloads (`scripts/e2e-whatsapp.mjs`);
> a live Meta connection needs the credentials below.

## Code map

| Piece | File |
|---|---|
| Webhook (GET verify, POST receive) | `src/app/api/webhooks/whatsapp/route.ts` |
| Signature check | `src/lib/whatsapp/signature.ts` |
| Payload parsing / normalisation | `src/lib/whatsapp/webhook.ts` |
| Graph API client | `src/lib/whatsapp/graph.ts` |
| Connect / disconnect / tokens | `src/services/whatsapp/accounts.service.ts` |
| Inbound storage + processing | `src/services/whatsapp/inbound.service.ts`, `src/jobs/whatsapp/process-event.ts` |
| Sending (24h window, templates) | `src/services/whatsapp/outbound.service.ts` |
| Merchant UI | `src/app/(app)/settings/whatsapp/` |

SellFlow uses **only** Meta's official Cloud API. No WhatsApp Web, QR-code
sessions, unofficial libraries or browser automation.

## Meta setup (one-time, platform level)

1. Create a Meta **Business** app at developers.facebook.com → add the **WhatsApp** product.
2. Become a **Tech Provider** (required for Embedded Signup for other businesses) and complete business verification.
3. **Facebook Login for Business** → create a configuration for WhatsApp Embedded Signup → note the **Configuration ID** → `META_CONFIG_ID`.
4. App settings → Basic: `META_APP_ID`, `META_APP_SECRET`.
5. Choose a random string for `META_VERIFY_TOKEN`.
6. WhatsApp → Configuration → Webhook:
   * Callback URL: `https://<your-domain>/api/webhooks/whatsapp`
   * Verify token: `META_VERIFY_TOKEN`
   * Subscribe to the `messages` field.
7. Local development: expose your dev server with a tunnel (e.g. `ngrok http 3000`) and use that URL as the callback.

Env: `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_VERIFY_TOKEN`, `META_GRAPH_API_VERSION` (default `v25.0`), and `CREDENTIALS_ENCRYPTION_KEY` (tokens are stored encrypted).

## Testing before you're a Tech Provider

Embedded Signup for other businesses requires Tech Provider approval. Until then, use
**Settings → WhatsApp → Advanced: connect with an access token** with your own app's
test number: WhatsApp Manager → API Setup gives the Phone number ID and WABA ID;
create a System User token with `whatsapp_business_messaging` + `whatsapp_business_management`.
Then use **Send test** (Meta's `hello_world` template) and reply from your phone.

## Running locally

```bash
npm run dev                      # app on :3000
ngrok http 3000                  # public URL for Meta's webhook
```

### Testing without Meta

* `node scripts/mock-graph.mjs` starts a local stand-in for the Graph API on :8299; set `META_GRAPH_BASE_URL=http://127.0.0.1:8299` (ignored when `NODE_ENV=production`). Messages containing `[fail]` are rejected so the failure path can be tested.
* `node --env-file=.env scripts/e2e-seed-inbox.mjs seed <business_id>` attaches a fake number to a test business and delivers signed messages from three customers through the real webhook. Also `message`, `status` and `cleanup` subcommands.

End-to-end webhook test (fake number on an existing test business; cleans up after itself):

```bash
node --env-file=.env scripts/e2e-whatsapp.mjs <business_id>
```

## Merchant connection (Embedded Signup)

1. Merchant clicks **Connect WhatsApp** → Meta's popup (JS SDK, `config_id`) → they pick/create a WABA and phone number.
2. The popup returns a short-lived `code` plus `waba_id` and `phone_number_id` (session info message).
3. Server exchanges the `code` for a business integration system-user token, **encrypts it** into `business_credentials`, and stores `whatsapp_accounts(waba_id, phone_number_id, display_phone_number, credential_id)`.
4. Server subscribes the app to the WABA (`POST /{waba_id}/subscribed_apps`) and registers the number if needed.

Tokens never reach the browser.

## Tenant routing

```
webhook payload → entry[].changes[].value.metadata.phone_number_id
               → whatsapp_accounts (phone_number_id UNIQUE) → business_id
```

Unknown `phone_number_id` ⇒ event is stored as `ignored` and nothing else happens. Tenant context is never inferred from message content.

## Webhook contract

* `GET /api/webhooks/whatsapp` — returns `hub.challenge` when `hub.mode=subscribe` and `hub.verify_token` matches.
* `POST /api/webhooks/whatsapp` — verifies `X-Hub-Signature-256` over the **raw** body, records one `whatsapp_events` row per message/status with an idempotent `event_key` (`msg:<wamid>` / `status:<wamid>:<status>`), processes it in the background after responding, and returns 200 immediately. Meta retries non-2xx responses, so processing is asynchronous and idempotent.
* Processing claims each event atomically (`received|failed → processing`), so it runs once even under concurrent retries; events from the same customer are processed in order (in-process queue per customer).
* Status updates only move forward (`sent → delivered → read`, `failed` is terminal), since Meta can deliver them out of order.
* The `whatsapp-sweep` scheduled task (every 5 min) re-processes events left `received`/`failed`, or stuck `processing`, from the last 24h.

## Messaging rules we respect

* Free-form replies only within 24h of the customer's last message (`conversations.last_customer_message_at`). Outside it, only approved **templates** (follow-ups, campaigns).
* Marketing messages only to customers with `marketing_opt_in`. A customer replying exactly **STOP** / **UNSUBSCRIBE** / **OPT OUT** is opted out (`opted_out_at`): pending follow-ups are cancelled, no automated or campaign messages are sent, and SellFlow confirms. **START** opts back in. The AI still answers messages the customer sends.
* Follow-ups outside the 24h window use the merchant's approved template (Settings → Automation; a template **without variables**, Marketing category), otherwise they're skipped.
* Failed or stuck inbound events are re-queued by a sweeper every 10 minutes (last 24h, up to 8 attempts).
