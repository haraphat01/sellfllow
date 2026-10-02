# Deployment

## Supabase (hosted)

1. Create a project at supabase.com (region close to your customers, e.g. `eu-west` / `af-south` if available).
2. Link and push migrations:
   ```bash
   supabase login
   supabase link --project-ref <ref>
   supabase db push
   npm run db:types
   ```
3. Auth → URL configuration: Site URL `https://<your-domain>`; Redirect URLs `https://<your-domain>/**` and `http://localhost:3000/**`.
4. Auth → Providers → Google (optional): create an OAuth client in Google Cloud with redirect `https://<ref>.supabase.co/auth/v1/callback`, paste client id/secret.
5. Make yourself a platform admin (SQL editor):
   ```sql
   update public.profiles set is_platform_admin = true where email = 'you@example.com';
   ```

## Coolify (VPS)

SellFlow runs as **one long-running Node.js server** (`npm run build` → `npm run start`). Background work needs no extra service:

* **Event-driven work** (incoming WhatsApp messages, AI replies, payment confirmations) runs in-process right after each webhook response (`src/jobs/events.ts`), with per-conversation ordering, a 3-second debounce for AI replies, and retries.
* **Timed work** runs as **Coolify scheduled tasks** that call protected endpoints (`src/jobs/scheduled.ts`).
* Run **one replica**. In-process ordering assumes a single server. Anything a restart interrupts is recovered by the `whatsapp-sweep` task.

1. Create the application from the Git repo (Nixpacks or Dockerfile, Node.js 24). Build `npm run build`, start `npm run start`, port 3000.
2. Add the environment variables from `.env.example`.
   * Generate `CREDENTIALS_ENCRYPTION_KEY` once (it must be the same everywhere that shares the database) and never change it.
   * Generate `CRON_SECRET` with `openssl rand -hex 32`.
   * Don't set `META_GRAPH_BASE_URL` or `PAYSTACK_BASE_URL`; they're only for local mocks.
3. Deploy. Check `https://<your-domain>/api/health`.
4. **Scheduled tasks**: in Coolify, open the application → **Scheduled Tasks** → add these four. The command runs inside the app container, where `CRON_SECRET` is already set:

   | Name | Command | Frequency |
   |---|---|---|
   | follow-ups | `node scripts/cron.mjs follow-ups` | `*/5 * * * *` |
   | whatsapp-sweep | `node scripts/cron.mjs whatsapp-sweep` | `*/5 * * * *` |
   | expire-orders | `node scripts/cron.mjs expire-orders` | `15 * * * *` |
   | billing | `node scripts/cron.mjs billing` | `5 * * * *` |

   The script calls `http://127.0.0.1:$PORT/api/cron/<task>`. If your image doesn't include `scripts/`, use this instead (same frequencies): `node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/cron/follow-ups',{method:'POST',headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then(r=>{console.log(r.status);process.exit(r.ok?0:1)})"`.
   **/admin → Settings → Scheduled tasks** shows when each task last ran and its result.
5. Point Meta and Paystack webhooks at the production domain (see WHATSAPP.md, PAYMENTS.md):
   * Meta → `https://<domain>/api/webhooks/whatsapp`
   * SellFlow's own Paystack account (`PAYSTACK_SECRET_KEY`: subscription billing and merchants' bank-account payouts) → `https://<domain>/api/webhooks/paystack/billing`
   * Ask Paystack to enable split payments / subaccounts on SellFlow's account before offering bank payouts (see PAYMENTS.md)

## Pre-deploy checklist

`npm run typecheck && npm run lint && npm test && npm run db:verify && npm run build`
