import type { Metadata } from "next";
import Link from "next/link";

import { ContactEmail, LegalShell } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Data deletion", description: "How to delete your data from SellFlow." };

const SECTIONS = [
  { id: "customers", title: "If you messaged a business" },
  { id: "merchants", title: "If you use SellFlow" },
  { id: "what", title: "What gets deleted" },
  { id: "kept", title: "What we must keep" },
  { id: "timeline", title: "Timeline" },
];

export default function DataDeletionPage() {
  return (
    <LegalShell
      title="Data deletion instructions"
      sections={SECTIONS}
      intro={
        <p>
          You can ask us to delete personal data that SellFlow holds about you. This page explains how, whether you are a customer who messaged a business on WhatsApp, or a
          business that uses SellFlow. See also our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      }
    >
      <section>
        <h2 id="customers">If you messaged a business that uses SellFlow</h2>
        <ul>
          <li>
            <strong className="text-foreground">To stop automated messages</strong> right away, reply <strong className="text-foreground">STOP</strong> in the WhatsApp chat
            with the business. Reply START if you change your mind.
          </li>
          <li>
            <strong className="text-foreground">To delete your data</strong>, ask the business directly — it controls your data. You can also email{" "}
            <ContactEmail subject="Data deletion request (customer)" /> with:
            <ul>
              <li>the WhatsApp phone number you used (with country code), and</li>
              <li>the name of the business you messaged.</li>
            </ul>
            We will pass your request to the business and help them delete your data. We may ask you to confirm the request from that WhatsApp number.
          </li>
        </ul>
      </section>

      <section>
        <h2 id="merchants">If your business uses SellFlow</h2>
        <ul>
          <li>
            The <strong className="text-foreground">business owner</strong> can request deletion of the whole business account by emailing{" "}
            <ContactEmail subject="Delete my SellFlow business" /> from the owner’s sign-in email address, with the business name.
          </li>
          <li>Team members can ask the owner to remove them, or email us to delete their own SellFlow login.</li>
          <li>
            Before deleting, you can cancel your subscription in <strong className="text-foreground">Billing</strong>, turn off payouts in{" "}
            <strong className="text-foreground">Settings → Payments</strong>, and disconnect WhatsApp in <strong className="text-foreground">Settings → WhatsApp</strong>.
          </li>
        </ul>
      </section>

      <section>
        <h2 id="what">What gets deleted</h2>
        <ul>
          <li>For a customer: your customer profile with that business, your conversations and messages, and personal details on your orders (name, phone, address, email).</li>
          <li>
            For a business: the business profile, team access, catalogue and images, customers, conversations, messages, AI settings, follow-ups and analytics, the encrypted
            WhatsApp access token and saved payment authorisation. The WhatsApp connection is removed and payouts are deactivated with Paystack.
          </li>
        </ul>
      </section>

      <section>
        <h2 id="kept">What we must keep</h2>
        <p>
          The law requires us to keep some records for a limited time — for example invoices and payment records for tax and accounting, and records needed to prevent fraud
          or resolve disputes and chargebacks. We keep only what is required, restrict access to it, and delete it when the retention period ends. Copies may remain in
          encrypted backups for a short period before they are overwritten.
        </p>
        <p>Messages already delivered to WhatsApp remain on the recipient’s phone; WhatsApp and Paystack also keep their own records under their policies.</p>
      </section>

      <section>
        <h2 id="timeline">Timeline</h2>
        <p>
          We confirm we have received your request within 7 days and complete deletion within 30 days of verifying it. We will tell you when it is done, or explain what we
          had to keep and why. Questions: <ContactEmail subject="Data deletion" />.
        </p>
      </section>
    </LegalShell>
  );
}
