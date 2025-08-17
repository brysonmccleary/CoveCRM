import Link from "next/link";

export default function LegalCenter() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Legal Center</h1>
      <p className="mb-6 text-lg">
        Welcome to the CRM Cove Legal Center. Below you’ll find all our current policies, terms, and compliance information. We’re committed to transparency, user rights, and platform protection.
      </p>

      <ul className="space-y-4 text-blue-500 underline text-lg">
        <li>
          <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </Link>
        </li>
        <li>
          <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </Link>
        </li>
        <li>
          <Link href="/legal/refund-policy" target="_blank" rel="noopener noreferrer">
            Refund Policy
          </Link>
        </li>
        <li>
          <Link href="/legal/acceptable-use" target="_blank" rel="noopener noreferrer">
            Acceptable Use Policy
          </Link>
        </li>
        <li>
          <Link href="/legal/affiliate-terms" target="_blank" rel="noopener noreferrer">
            Affiliate Program Terms
          </Link>
        </li>
      </ul>

      <div className="mt-10 border-t pt-6 text-sm text-gray-600 space-y-4">
        <p>
          💬 Questions or legal inquiries? Email us at{" "}
          <a href="mailto:legal@covecrm.com" className="text-blue-500 underline">
            legal@covecrm.com
          </a>
        </p>
        <p>
          📍 You may use this email for GDPR or CCPA requests, data deletion, terms clarifications, DMCA notices, or compliance issues.
        </p>
      </div>
    </div>
  );
}
