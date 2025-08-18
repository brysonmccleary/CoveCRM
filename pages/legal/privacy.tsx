export default function PrivacyPolicy() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
      <p className="mb-4">Effective Date: July 22, 2025</p>
      <p className="mb-4">
        CRM Cove respects your privacy. This policy explains how we collect,
        use, and protect your data.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        1. Information Collected
      </h2>
      <p className="mb-4">
        We collect your name, email, company info, payment details, and
        contact/lead data when you register or use our platform.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">2. Use of Data</h2>
      <p className="mb-4">
        We use your data to deliver CRM features, provide customer support,
        manage billing, and improve CRM Cove. We do not sell your data.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        3. Third-Party Services
      </h2>
      <p className="mb-4">
        We use third-party services like Stripe (payments), Twilio (SMS), Google
        Calendar (bookings), and Resend (email). These tools may access basic
        data required to perform their services.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">4. Data Security</h2>
      <p className="mb-4">
        We implement reasonable security measures, including encryption and
        access controls, to protect your information. However, no platform can
        guarantee 100% security.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">5. GDPR & CCPA</h2>
      <p className="mb-4">
        You may request access to or deletion of your personal data by emailing{" "}
        <a
          href="mailto:support@covecrm.com"
          className="text-blue-600 underline"
        >
          support@covecrm.com
        </a>
        . We comply with GDPR (Europe) and CCPA (California) regulations.
      </p>
    </div>
  );
}
