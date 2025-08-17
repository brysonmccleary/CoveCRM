export default function AffiliateTerms() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Affiliate Program Terms</h1>
      <p className="mb-4">Effective Date: July 22, 2025</p>

      <h2 className="text-xl font-semibold mt-6 mb-2">1. Overview</h2>
      <p className="mb-4">
        CRM Cove offers an affiliate program that pays $25 per referred user who signs up for a paid subscription. Payouts are processed weekly through Stripe Connect, with a minimum payout threshold of $50.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">2. Commission Rules</h2>
      <ul className="list-disc ml-6 mb-4">
        <li>Referrals must sign up using your unique affiliate link.</li>
        <li>Only paying users count toward commissions.</li>
        <li>Cancelled or refunded users do not count toward payouts.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-6 mb-2">3. Promotional Requirements</h2>
      <ul className="list-disc ml-6 mb-4">
        <li>Affiliates must not misrepresent CRM Cove in any way.</li>
        <li>Deceptive ads, fake testimonials, or misleading claims are strictly prohibited.</li>
        <li>FTC guidelines require proper affiliate disclosures in all promotions.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-6 mb-2">4. Fraud & Abuse</h2>
      <p className="mb-4">
        If fraudulent or unethical behavior is detected, commissions may be withheld or revoked. This includes self-referrals, coupon abuse, or spamming.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">5. Termination</h2>
      <p className="mb-4">
        We reserve the right to suspend or terminate your affiliate access at any time for violating these terms.
      </p>
    </div>
  );
}
