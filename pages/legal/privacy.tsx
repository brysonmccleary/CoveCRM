// /pages/legal/privacy.tsx
export default function PrivacyPolicy() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
      <p className="mb-4">Effective Date: July 22, 2025</p>

      <p className="mb-4">
        CRM Cove (&quot;CoveCRM&quot;, &quot;we&quot;, &quot;us&quot;, or
        &quot;our&quot;) respects your privacy. This policy explains how we
        collect, use, share, and protect your information when you use
        covecrm.com and related services.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        1. Information We Collect
      </h2>
      <p className="mb-2">We may collect the following information:</p>
      <ul className="list-disc list-inside mb-4 space-y-1">
        <li>Name, email address, company and account details.</li>
        <li>Payment information (processed by our payment providers).</li>
        <li>
          Lead and contact data you import or create (names, phone numbers,
          notes, tags, appointment history, etc.).
        </li>
        <li>
          Usage data, log data, device information, and settings related to how
          you use CoveCRM.
        </li>
      </ul>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        2. Google User Data (Sheets, Drive &amp; Calendar)
      </h2>
      <p className="mb-2">
        CoveCRM offers optional integrations with Google services. When you
        connect your Google account, we may access limited Google user data
        only as necessary to provide these features:
      </p>
      <ul className="list-disc list-inside mb-4 space-y-1">
        <li>
          <span className="font-semibold">Google Sheets / Drive:</span> We use
          Google Sheets and Drive-related scopes (including{" "}
          <code className="bg-gray-100 px-1 rounded">
            spreadsheets.readonly
          </code>{" "}
          and{" "}
          <code className="bg-gray-100 px-1 rounded">drive.file</code>) to
          allow you to select specific spreadsheets and import lead data from
          those files into CoveCRM. We only access the spreadsheets and files
          you choose, and we do not read or modify other files in your Google
          Drive.
        </li>
        <li>
          <span className="font-semibold">Google Calendar:</span> We use
          calendar scopes (such as{" "}
          <code className="bg-gray-100 px-1 rounded">calendar.events</code>) to
          create, update, and read events on the calendars you select so that
          appointments booked in CoveCRM sync to your Google Calendar and
          vice-versa.
        </li>
        <li>
          <span className="font-semibold">Identity:</span> We use basic
          identity scopes (email, profile, and openid) to authenticate you,
          link your CoveCRM account to your Google account, and display your
          account information.
        </li>
      </ul>

      <p className="mb-4">
        Google user data obtained through these integrations is used solely to
        provide CoveCRM functionality for your account (for example, lead
        imports and calendar syncing). We do <span className="font-semibold">
          not
        </span>{" "}
        sell Google user data, and we do{" "}
        <span className="font-semibold">not</span> use Google user data to
        train generalized AI or machine learning models.
      </p>
      <p className="mb-4">
        You can disconnect Google at any time from within CoveCRM (where
        available) or directly in your Google Account permissions. When you
        disconnect, we stop accessing your Google data going forward; previously
        imported leads and events remain in your CoveCRM account unless you
        delete them.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        3. How We Use Your Information
      </h2>
      <p className="mb-2">We use the information we collect to:</p>
      <ul className="list-disc list-inside mb-4 space-y-1">
        <li>Provide and operate the CoveCRM platform and features.</li>
        <li>
          Import, manage, and sync leads, contacts, conversations, and
          appointments.
        </li>
        <li>
          Process subscriptions, payments, and account-related transactions.
        </li>
        <li>Provide customer support and respond to your requests.</li>
        <li>Monitor usage, prevent abuse, and improve our services.</li>
        <li>Send service-related emails, notifications, and updates.</li>
      </ul>
      <p className="mb-4">
        We do <span className="font-semibold">not</span> sell your personal
        information or your leads.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        4. How We Share and Disclose Data
      </h2>
      <p className="mb-2">
        We may share your information, including Google user data, only in the
        following limited situations:
      </p>
      <ul className="list-disc list-inside mb-4 space-y-1">
        <li>
          <span className="font-semibold">Service providers:</span> With
          trusted third-party processors that help us run CoveCRM (for example:
          cloud hosting, database providers, payment processors like Stripe,
          SMS/telephony providers like Twilio, email providers like Resend, and
          analytics tools). These providers are contractually restricted to
          using the data only to provide services to us.
        </li>
        <li>
          <span className="font-semibold">Legal obligations:</span> When we are
          required to do so by law, subpoena, or valid legal process, or to
          protect our rights, users, or the public.
        </li>
        <li>
          <span className="font-semibold">Business transfers:</span> In
          connection with a merger, acquisition, financing, or sale of all or a
          portion of our business, subject to appropriate confidentiality
          protections.
        </li>
      </ul>
      <p className="mb-4">
        We do <span className="font-semibold">not</span> share Google user data
        with advertisers or unrelated third parties for their independent
        marketing purposes.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">5. Data Security</h2>
      <p className="mb-4">
        We implement reasonable technical and organizational measures to
        protect your information, including encryption in transit and access
        controls. However, no method of transmission or storage is 100% secure,
        and we cannot guarantee absolute security.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        6. Data Retention &amp; Deletion
      </h2>
      <p className="mb-4">
        We retain your account data and lead data for as long as your account
        is active or as needed to provide our services. You may delete leads,
        conversations, or your entire account from within CoveCRM, or you can
        request deletion by contacting us at{" "}
        <a
          href="mailto:support@covecrm.com"
          className="text-blue-600 underline"
        >
          support@covecrm.com
        </a>
        . We may retain certain information as required by law or for legitimate
        business purposes (such as fraud prevention or accounting).
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        7. Your Rights (GDPR &amp; CCPA)
      </h2>
      <p className="mb-2">
        Depending on your location, you may have rights over your personal
        data, including:
      </p>
      <ul className="list-disc list-inside mb-4 space-y-1">
        <li>Accessing the personal data we hold about you.</li>
        <li>Requesting correction or deletion of your data.</li>
        <li>
          Objecting to or restricting certain types of processing, or withdrawing
          consent where applicable.
        </li>
        <li>
          Requesting a copy of your data in a portable format where required by
          law.
        </li>
      </ul>
      <p className="mb-4">
        To exercise these rights, contact us at{" "}
        <a
          href="mailto:support@covecrm.com"
          className="text-blue-600 underline"
        >
          support@covecrm.com
        </a>
        . We comply with applicable privacy laws, including the EU General Data
        Protection Regulation (GDPR) and the California Consumer Privacy Act
        (CCPA), where they apply.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        8. Children&apos;s Privacy
      </h2>
      <p className="mb-4">
        CoveCRM is intended for use by businesses and professionals. It is not
        directed to children under 13, and we do not knowingly collect personal
        information from children under 13.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        9. Changes to This Policy
      </h2>
      <p className="mb-4">
        We may update this Privacy Policy from time to time. If we make material
        changes, we will update the &quot;Effective Date&quot; at the top of
        this page and, where appropriate, provide additional notice.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">10. Contact Us</h2>
      <p className="mb-4">
        If you have any questions about this Privacy Policy or how we handle
        your data, please contact us at{" "}
        <a
          href="mailto:support@covecrm.com"
          className="text-blue-600 underline"
        >
          support@covecrm.com
        </a>
        .
      </p>
    </div>
  );
}
