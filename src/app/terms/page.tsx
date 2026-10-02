import type { Metadata } from "next";
import Link from "next/link";

import { ContactEmail, LegalShell, legalContact } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms of Service", description: "The terms for using SellFlow." };

const SECTIONS = [
  { id: "service", title: "The service" },
  { id: "accounts", title: "Accounts" },
  { id: "whatsapp", title: "WhatsApp rules" },
  { id: "your-responsibilities", title: "Your responsibilities" },
  { id: "ai", title: "The AI assistant" },
  { id: "payments", title: "Customer payments" },
  { id: "subscriptions", title: "Subscriptions & billing" },
  { id: "acceptable-use", title: "Acceptable use" },
  { id: "data", title: "Your data" },
  { id: "suspension", title: "Suspension & termination" },
  { id: "third-parties", title: "Third-party services" },
  { id: "disclaimers", title: "Disclaimers" },
  { id: "liability", title: "Liability" },
  { id: "law", title: "Governing law" },
  { id: "changes", title: "Changes" },
  { id: "contact", title: "Contact" },
];

export default function TermsPage() {
  const c = legalContact();
  return (
    <LegalShell
      title="Terms of Service"
      sections={SECTIONS}
      intro={
        <p>
          These terms are an agreement between {c.name} (“SellFlow”, “we”) and the business that creates a SellFlow account (“you”). By creating an account or using
          SellFlow you accept these terms on behalf of your business. If you don’t agree, don’t use SellFlow.
        </p>
      }
    >
      <section>
        <h2 id="service">1. The service</h2>
        <p>
          SellFlow helps businesses sell through WhatsApp: it connects to your WhatsApp Business account through Meta’s official WhatsApp Business Platform, can answer
          customers with an AI assistant using your catalogue and policies, create orders, send Paystack payment links, follow up with interested customers, and show
          analytics. Features depend on your plan.
        </p>
      </section>

      <section>
        <h2 id="accounts">2. Accounts</h2>
        <ul>
          <li>You must be at least 18 and authorised to act for your business, and give accurate information.</li>
          <li>You are responsible for your team members’ access and for everything done in your account. Keep sign-in details secure and tell us about unauthorised use.</li>
          <li>The account owner controls billing, payout details and team permissions.</li>
        </ul>
      </section>

      <section>
        <h2 id="whatsapp">3. WhatsApp rules</h2>
        <p>
          You must follow the WhatsApp Business Terms, WhatsApp Business Messaging Policy and WhatsApp Commerce Policy, including: only messaging people who have contacted
          you or agreed to hear from you; using approved templates outside WhatsApp’s 24-hour window; honouring opt-outs (SellFlow stops automated messages when a customer
          replies STOP); and not selling prohibited goods. Meta may restrict your number if these rules are broken — SellFlow cannot reverse Meta’s decisions.
        </p>
      </section>

      <section>
        <h2 id="your-responsibilities">4. Your responsibilities</h2>
        <ul>
          <li>Your catalogue, prices, stock, delivery fees and policies are accurate and kept up to date — the AI relies on them.</li>
          <li>You fulfil the orders you accept, handle customer service, returns and refunds, and comply with consumer-protection, tax and other laws that apply to your business.</li>
          <li>You have a lawful basis to process your customers’ data through SellFlow, and you tell your customers how you use their data. We process it on your behalf as described in our <Link href="/privacy">Privacy Policy</Link>.</li>
        </ul>
      </section>

      <section>
        <h2 id="ai">5. The AI assistant</h2>
        <p>
          The AI assistant is designed to use only your catalogue, stock, policies and order information, to ask customers to confirm before creating an order, and to hand
          conversations to your team when it is unsure. Even so, AI can make mistakes. You are responsible for your business’s communications with customers: review
          conversations, keep your information accurate, and take over whenever needed. You can pause the AI or switch it off at any time.
        </p>
      </section>

      <section>
        <h2 id="payments">6. Customer payments</h2>
        <ul>
          <li>
            Customer payments are processed by <strong className="text-foreground">Paystack</strong>. You give us a bank account; we register it with Paystack as a
            subaccount of SellFlow’s Paystack account, and Paystack settles your share of each payment directly to that bank account. SellFlow does not hold your funds.
            Settlement timing is set by Paystack.
          </li>
          <li>
            SellFlow may charge a fee per successful sale collected this way. The current fee is shown in Settings → Payments before you add your bank account; Paystack’s
            processing fee is deducted from your share. We will give notice before increasing the fee.
          </li>
          <li>
            An order is marked paid only after Paystack confirms the payment. Refunds you request, and chargebacks or reversals on your sales, may be deducted from your
            future settlements or recovered from you.
          </li>
          <li>You must provide a bank account that you or your business own, and keep payout details accurate. You must also comply with Paystack’s terms of service.</li>
        </ul>
      </section>

      <section>
        <h2 id="subscriptions">7. Subscriptions & billing</h2>
        <ul>
          <li>New businesses may start with a free trial. When it ends, you need a paid plan to keep using paid features such as the AI assistant and automation.</li>
          <li>Plans are billed in advance for each period through Paystack. If you save a card, renewals are charged to it automatically at the then-current plan price until you cancel.</li>
          <li>Upgrades take effect immediately; you pay the prorated difference for the rest of the current period. Downgrades take effect at the next renewal.</li>
          <li>You can cancel at any time; your plan stays active until the end of the paid period and then ends. Fees already paid are non-refundable, except where the law requires otherwise.</li>
          <li>If a renewal payment fails, you have a 3-day grace period to pay before the AI assistant and automations stop. Your data is kept.</li>
          <li>Each plan has usage limits (for example AI conversations, messages and orders). When a limit is reached, the related automation pauses and conversations are handed to your team until the next period or an upgrade.</li>
          <li>We may change plan prices or limits with at least 30 days’ notice; changes apply from your next renewal.</li>
        </ul>
      </section>

      <section>
        <h2 id="acceptable-use">8. Acceptable use</h2>
        <p>You must not use SellFlow to:</p>
        <ul>
          <li>send spam, unsolicited bulk messages, or messages to people who opted out;</li>
          <li>sell illegal, counterfeit or prohibited goods or services, or engage in fraud or deception;</li>
          <li>harass, threaten or discriminate against anyone, or share unlawful content;</li>
          <li>try to access other businesses’ data, probe or disrupt the service, or get around plan limits or security measures;</li>
          <li>resell SellFlow or use it to build a competing product without our written permission.</li>
        </ul>
      </section>

      <section>
        <h2 id="data">9. Your data</h2>
        <p>
          You own your business data and your customers’ data. You give us permission to process it only to provide, secure and improve SellFlow for you, as described in
          our <Link href="/privacy">Privacy Policy</Link>. We own SellFlow itself, including its software and design. You can ask us to delete your data as described on
          our <Link href="/data-deletion">Data deletion</Link> page.
        </p>
      </section>

      <section>
        <h2 id="suspension">10. Suspension & termination</h2>
        <p>
          We may suspend or close an account that breaks these terms, puts customers or the service at risk, is involved in fraud or chargeback abuse, or as required by
          law, Meta or Paystack. Where reasonable, we will tell you why and give you a chance to fix the problem. You can stop using SellFlow at any time. After an account
          is closed, we delete its data as described in our Privacy Policy.
        </p>
      </section>

      <section>
        <h2 id="third-parties">11. Third-party services</h2>
        <p>
          SellFlow depends on services we don’t control, including Meta’s WhatsApp Business Platform, Paystack and AI model providers. Their availability, rules and
          decisions (such as message template approvals, number restrictions or payment holds) are governed by their own terms.
        </p>
      </section>

      <section>
        <h2 id="disclaimers">12. Disclaimers</h2>
        <p>
          We work hard to keep SellFlow reliable, but it is provided “as is” and “as available”. To the extent the law allows, we do not guarantee that it will be
          uninterrupted or error-free, that every message will be delivered, or that the AI will always be correct, and we do not guarantee any level of sales.
        </p>
      </section>

      <section>
        <h2 id="liability">13. Liability</h2>
        <p>
          To the extent the law allows, SellFlow is not liable for indirect or consequential losses such as lost profits, lost sales or lost data, and our total liability
          for any claim relating to SellFlow is limited to the subscription fees you paid us in the 12 months before the claim. Nothing in these terms limits liability that
          cannot be limited by law. You will compensate us for claims arising from your breach of these terms, your products, or your use of customers’ data.
        </p>
      </section>

      <section>
        <h2 id="law">14. Governing law</h2>
        <p>
          These terms are governed by the laws of the Federal Republic of Nigeria. We will try to resolve any dispute with you informally first; otherwise the courts of
          Nigeria have jurisdiction.
        </p>
      </section>

      <section>
        <h2 id="changes">15. Changes to these terms</h2>
        <p>
          We may update these terms. We will post the new version here and, for material changes, notify you at least 14 days before they take effect. Continuing to use
          SellFlow after that means you accept the new terms.
        </p>
      </section>

      <section>
        <h2 id="contact">16. Contact</h2>
        <p>
          <ContactEmail subject="Terms" />
          {c.address ? <> · {c.address}</> : null}
        </p>
      </section>
    </LegalShell>
  );
}
