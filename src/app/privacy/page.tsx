import type { Metadata } from "next";
import Link from "next/link";

import { ContactEmail, LegalShell, legalContact } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy Policy", description: "How SellFlow collects, uses and protects personal data." };

const SECTIONS = [
  { id: "who", title: "Who we are" },
  { id: "roles", title: "Our two roles" },
  { id: "collect", title: "Data we collect" },
  { id: "use", title: "How we use it" },
  { id: "ai", title: "AI processing" },
  { id: "sharing", title: "Service providers" },
  { id: "transfers", title: "International transfers" },
  { id: "security", title: "Security" },
  { id: "retention", title: "Retention" },
  { id: "rights", title: "Your rights" },
  { id: "cookies", title: "Cookies" },
  { id: "children", title: "Children" },
  { id: "changes", title: "Changes" },
  { id: "contact", title: "Contact" },
];

export default function PrivacyPage() {
  const c = legalContact();
  return (
    <LegalShell
      title="Privacy Policy"
      sections={SECTIONS}
      intro={
        <p>
          This policy explains how {c.name} (“SellFlow”, “we”) collects, uses, shares and protects personal data when businesses use SellFlow to sell through WhatsApp, and when
          their customers message those businesses. We process personal data in line with the Nigeria Data Protection Act 2023 and other laws that apply to us.
        </p>
      }
    >
      <section>
        <h2 id="who">Who we are</h2>
        <p>
          SellFlow is software that helps businesses answer customers on WhatsApp, take orders, collect payments and follow up with interested buyers. It works with the
          official WhatsApp Business Platform from Meta — we do not use WhatsApp Web or unofficial WhatsApp tools.
        </p>
        <p>
          Contact: <ContactEmail subject="Privacy" />
          {c.address ? <> · {c.address}</> : null}
        </p>
      </section>

      <section>
        <h2 id="roles">Our two roles</h2>
        <ul>
          <li>
            <strong className="text-foreground">For businesses that use SellFlow</strong> (“merchants”) and their team members, we are the <em>controller</em> of account,
            billing and usage data.
          </li>
          <li>
            <strong className="text-foreground">For the customers of those businesses</strong> — people who message a business on WhatsApp — we act as a <em>processor</em> on
            the business’s behalf. The business decides why their customers’ data is processed and is responsible for it. If you are a customer, please contact the business
            first; we will help them respond to you.
          </li>
        </ul>
      </section>

      <section>
        <h2 id="collect">Data we collect</h2>
        <h3>From merchants and their team</h3>
        <ul>
          <li>Account details: name, email address, password (stored only as a secure hash by our authentication provider) and sign-in records.</li>
          <li>Business details: business name, description, industry, phone, address, website, social links, time zone and currency.</li>
          <li>Catalogue: products, prices, stock and images you upload.</li>
          <li>WhatsApp connection: your WhatsApp Business account and phone number IDs and an access token issued by Meta (encrypted).</li>
          <li>Payout details: the bank, the last four digits of the account number, and the account name returned by Paystack’s account lookup. We do not store full account numbers.</li>
          <li>Subscription billing: plan, invoices, and card brand, last four digits and expiry. Card numbers are handled by Paystack; we only keep an encrypted Paystack authorisation code used to charge renewals.</li>
          <li>Settings, AI instructions and policies you write, and records of actions taken in your account (audit logs).</li>
        </ul>
        <h3>From customers who message a business</h3>
        <ul>
          <li>WhatsApp phone number, WhatsApp profile name, and the messages exchanged with the business (text and media sent through WhatsApp).</li>
          <li>Details shared to place an order, such as name, delivery address and email address.</li>
          <li>Orders, order status and payment status. Payments are made on Paystack’s checkout; we receive the payment result but never card or bank login details.</li>
          <li>Whether the customer has opted out of automated messages (by replying STOP).</li>
        </ul>
        <h3>Automatically</h3>
        <ul>
          <li>Technical logs (IP address, browser, request times and errors) needed to run, secure and troubleshoot the service.</li>
          <li>Essential cookies that keep you signed in (see Cookies).</li>
        </ul>
      </section>

      <section>
        <h2 id="use">How we use it</h2>
        <ul>
          <li>To provide SellFlow: receive and send WhatsApp messages for a business, answer customers, create orders, generate payment links and confirm payments.</li>
          <li>To send automated follow-ups that a business has turned on — never to customers who replied STOP.</li>
          <li>To show businesses their conversations, customers, orders and analytics.</li>
          <li>To bill merchants for their SellFlow subscription and enforce plan limits.</li>
          <li>To keep the service secure, prevent fraud and abuse, and meet legal obligations.</li>
          <li>To contact merchants about their account, billing and important changes.</li>
        </ul>
        <p>
          Our legal bases are performance of our contract with merchants, our and the merchant’s legitimate interests in running and securing the service, compliance with
          legal obligations, and consent where required (for example, a business’s marketing messages). We do not sell personal data, and we do not use customers’ messages
          to advertise to them.
        </p>
      </section>

      <section>
        <h2 id="ai">AI processing</h2>
        <p>
          When a business turns on SellFlow’s AI assistant, recent messages in the conversation, a short summary of the conversation, and the business’s own catalogue and
          policies are sent to an AI model provider to generate a reply. The AI can only look up information through SellFlow (such as product prices, stock and order
          status) for that business. Businesses can pause the AI or take over any conversation at any time.
        </p>
        <p>
          We use AI providers through their business APIs. We send only what is needed for the reply and we do not authorise providers to use this data to train their
          models where their terms allow us to opt out.
        </p>
      </section>

      <section>
        <h2 id="sharing">Service providers we share data with</h2>
        <p>We share personal data only with providers that help us run SellFlow, under contracts that limit how they may use it:</p>
        <ul>
          <li><strong className="text-foreground">Meta Platforms (WhatsApp Business Platform)</strong> — to send and receive WhatsApp messages.</li>
          <li><strong className="text-foreground">Paystack</strong> — payment checkout, payouts to merchants’ bank accounts, refunds and SellFlow subscription payments.</li>
          <li><strong className="text-foreground">Supabase</strong> — database, authentication and file storage.</li>
          <li><strong className="text-foreground">Vercel</strong> — application hosting and, where used, routing requests to AI models.</li>
          <li><strong className="text-foreground">AI model providers</strong> (such as DeepSeek, and models made available through Vercel’s AI Gateway) — to generate assistant replies.</li>
          <li><strong className="text-foreground">Inngest</strong> — running background tasks such as processing incoming messages and follow-ups.</li>
        </ul>
        <p>
          We may also disclose data if required by law, to protect the rights and safety of users or the public, or as part of a merger or acquisition (with notice to
          merchants). A business can see its own customers’ data in its SellFlow account; businesses never see each other’s data.
        </p>
      </section>

      <section>
        <h2 id="transfers">International transfers</h2>
        <p>
          Some of our providers store or process data outside Nigeria. Where we transfer personal data internationally, we rely on safeguards permitted by the Nigeria
          Data Protection Act, such as contractual protections and providers’ security commitments.
        </p>
      </section>

      <section>
        <h2 id="security">Security</h2>
        <ul>
          <li>Each business’s data is separated at the database level, so one business cannot access another’s data.</li>
          <li>WhatsApp access tokens and payment authorisations are encrypted (AES-256-GCM) and never sent to browsers.</li>
          <li>Messages from WhatsApp and Paystack are accepted only with valid signatures, and payments are confirmed directly with Paystack before an order is marked paid.</li>
          <li>Access is limited by role and permission, and important actions are recorded in audit logs.</li>
        </ul>
        <p>No system is perfectly secure. If we become aware of a breach affecting your data, we will notify you and the relevant authority as the law requires.</p>
      </section>

      <section>
        <h2 id="retention">Retention</h2>
        <p>
          We keep merchant and customer data for as long as the merchant’s account is active, so the business can see its history. When a merchant closes their account or
          asks us to delete data, we delete it within 30 days, except records we must keep for legal, tax, accounting, fraud-prevention or dispute purposes (such as
          invoices and payment records), which we keep only as long as required. See <Link href="/data-deletion">Data deletion</Link>.
        </p>
      </section>

      <section>
        <h2 id="rights">Your rights</h2>
        <p>
          Subject to the law, you can ask to access, correct, delete or receive a copy of your personal data, object to or restrict processing, and withdraw consent. To
          stop automated messages from a business, reply <strong className="text-foreground">STOP</strong> in the WhatsApp chat (reply START to resume).
        </p>
        <p>
          Customers of a business should contact that business first; you can also email <ContactEmail subject="Data request" /> and we will help the business respond. We
          answer requests within 30 days and may need to verify your identity. You can also complain to the Nigeria Data Protection Commission.
        </p>
      </section>

      <section>
        <h2 id="cookies">Cookies</h2>
        <p>
          The SellFlow dashboard uses only essential cookies: to keep you signed in securely and to remember which business you are working in. We do not use advertising
          or third-party tracking cookies. Payment pages are provided by Paystack under its own policies.
        </p>
      </section>

      <section>
        <h2 id="children">Children</h2>
        <p>SellFlow is a business tool and is not directed at children under 18. Merchants must not use SellFlow to knowingly market to children where the law forbids it.</p>
      </section>

      <section>
        <h2 id="changes">Changes to this policy</h2>
        <p>We may update this policy. We will post the new version here with a new date and, for significant changes, notify merchants by email or in the dashboard.</p>
      </section>

      <section>
        <h2 id="contact">Contact</h2>
        <p>
          Questions or requests: <ContactEmail subject="Privacy" />
          {c.address ? <> · {c.address}</> : null}
        </p>
      </section>
    </LegalShell>
  );
}
