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

## Vercel

1. Import the repo (framework: Next.js). Node.js 24.
2. Add environment variables from `.env.example` for Production and Preview (`vercel env add …` or the dashboard). Generate `CREDENTIALS_ENCRYPTION_KEY` once and never rotate it without re-encrypting credentials.
3. Deploy. Check `https://<your-domain>/api/health`.
4. Inngest (Phase 8): install the Inngest integration from the Vercel Marketplace; it sets `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` and syncs `/api/inngest`.
5. Point Meta and Paystack webhooks at the production domain (see WHATSAPP.md, PAYMENTS.md):
   * Meta → `https://<domain>/api/webhooks/whatsapp`
   * SellFlow's own Paystack account (`PAYSTACK_SECRET_KEY`: subscription billing and merchants' bank-account payouts) → `https://<domain>/api/webhooks/paystack/billing`
   * Ask Paystack to enable split payments / subaccounts on SellFlow's account before offering bank payouts (see PAYMENTS.md)

## Pre-deploy checklist

`npm run typecheck && npm run lint && npm test && npm run db:verify && npm run build`
