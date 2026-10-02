# SellFlow

**Turn WhatsApp conversations into sales.**

AI-powered sales infrastructure for businesses selling through WhatsApp: an AI
sales agent that answers from your real catalogue, creates orders, collects
Paystack payments and recovers lost sales — while your team stays in control.

Multi-tenant SaaS on Next.js 16 + Supabase, built on Meta's official WhatsApp
Business Platform.

| Doc | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Decisions, layers, request flows, phase plan |
| [DATABASE.md](DATABASE.md) | Schema, conventions, integrity guards, migrations |
| [SECURITY.md](SECURITY.md) | Tenant isolation, secrets, webhooks, prompt-injection defence |
| [WHATSAPP.md](WHATSAPP.md) | Meta setup, Embedded Signup, webhook contract |
| [AI.md](AI.md) | Agent, tools, state, handoff |
| [PAYMENTS.md](PAYMENTS.md) | Paystack flows |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Supabase + Vercel production setup |

## Local development

Requirements: Node 24, Supabase CLI, Docker (for `db:verify`).

```bash
npm install
cp .env.example .env.local     # fill in Supabase URL + keys, CREDENTIALS_ENCRYPTION_KEY
supabase login && supabase link --project-ref <ref>
supabase db push               # apply migrations to your Supabase project
npm run dev                    # http://localhost:3000
```

Or run Supabase locally with `supabase start` (Docker) and use the printed URL/keys.

## Scripts

| | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | TypeScript / ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:integration` | Integration tests against Supabase (see AI.md) |
| `npm run db:verify` | Apply all migrations to a throwaway Postgres and run tenant-isolation tests |
| `npm run db:push` | Push migrations to the linked Supabase project |
| `npm run inngest:dev` | Inngest dev server (background jobs, e.g. WhatsApp processing) |
| `npm run db:types` | Regenerate `src/db/types/database.ts` from the linked project (`db:types:local` without one) |

## What needs external credentials

| Feature | Needs |
|---|---|
| Sign up / dashboard | Supabase project |
| Google sign-in | Google OAuth client configured in Supabase |
| WhatsApp messaging | Meta app, Tech Provider, Embedded Signup config (WHATSAPP.md) |
| AI replies | AI Gateway key |
| Payments | Merchant's Paystack keys; platform key for subscriptions |
| Background jobs | Inngest (local dev server needs nothing) |
# sellfllow
