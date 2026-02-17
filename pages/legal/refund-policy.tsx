export default function RefundPolicy() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Refund Policy</h1>
      <p className="mb-4">Effective Date: July 22, 2025</p>
      <p className="mb-4">
        All subscriptions to Cove CRM are billed in advance (monthly or
        annually) via Stripe. By purchasing a subscription, you agree to the
        billing terms.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        1. No Refunds for Usage
      </h2>
      <p className="mb-4">
        We do not issue refunds for partially used billing cycles, unused
        credits, or accounts that fail to cancel before renewal.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">2. Refund Eligibility</h2>
      <p className="mb-4">
        You may request a refund within 7 days of the initial charge only if
        there is a system issue or service outage that prevented use.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        3. How to Request a Refund
      </h2>
      <p className="mb-4">
        Submit your request to{" "}
        <a
          href="mailto:support@covecrm.com"
          className="text-blue-600 underline"
        >
          support@covecrm.com
        </a>
        . Include your account email, reason for the request, and proof of
        issue. We typically respond within 3 business days.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">4. Billing Disputes</h2>
      <p className="mb-4">
        Chargebacks without prior contact may result in permanent account
        suspension. Contact support first to resolve any billing concerns.
      </p>
    </div>
  );
}
