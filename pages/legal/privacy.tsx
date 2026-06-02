// /pages/legal/privacy.tsx
export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Privacy Policy</h1>
        <p className="mb-4">Effective Date: July 22, 2025</p>

        <p className="mb-6">
          Cove CRM (&quot;CoveCRM&quot;, &quot;we&quot;, &quot;us&quot;, or
          &quot;our&quot;) respects your privacy. This policy explains how we
          collect, use, share, and protect your information when you use
          covecrm.com and related services.
        </p>

        {/* 1. Information We Collect */}
        <h2 className="text-xl font-semibold mt-6 mb-2">
          1. Information We Collect
        </h2>
        <p className="mb-2">We may collect the following information:</p>
        <ul className="list-disc list-inside space-y-1 mb-4">
          <li>Name, email address, company and account details.</li>
          <li>Payment information (processed by our payment providers).</li>
          <li>
            Lead and contact data you import or create (names, phone numbers,
            notes, tags, appointment history, etc.).
          </li>
          <li>
            Communication data, including SMS message contents, call recordings,
            call transcripts, call notes, AI-generated summaries, appointment
            communications, message delivery information, call status,
            timestamps, phone numbers, email addresses, and related communication
            metadata.
          </li>
          <li>
            Usage data, log data, device information, and settings related to
            how you use CoveCRM.
          </li>
        </ul>

        {/* 2. Google User Data */}
        <h2 className="text-xl font-semibold mt-6 mb-2">
          2. Google User Data (Calendar)
        </h2>
        <p className="mb-4">
          CoveCRM offers an optional integration with Google Calendar. When you
          connect your Google account, we may access limited Google user data
          only as necessary to provide this feature:
        </p>

        <ul className="list-disc list-inside space-y-2 mb-4">
          <li>
            <span className="font-semibold">Google Calendar:</span> We use the
            calendar scope{" "}
            <span className="italic">
              https://www.googleapis.com/auth/calendar
            </span>{" "}
            to create, update, and read events on the calendars you select so
            that appointments booked in CoveCRM sync to your Google Calendar and
            vice versa.
          </li>
          <li>
            <span className="font-semibold">Identity:</span> We use basic
            identity scopes (email, profile, and openid) to authenticate you,
            link your CoveCRM account to your Google account, and display your
            account information.
          </li>
        </ul>

        <p className="mb-4">
          Google user data obtained through this integration is used solely to
          provide CoveCRM functionality for your account (for example, calendar
          syncing). We do not sell Google user data, and we do not use Google
          user data to train generalized AI or machine learning models.
        </p>

        <p className="mb-6">
          You can disconnect Google at any time from within CoveCRM (where
          available) or directly in your Google Account permissions. When you
          disconnect, we stop accessing your Google data going forward; events
          and records already stored in CoveCRM remain in your CoveCRM account
          unless you delete them.
        </p>

        {/* 3. How We Use Your Information */}
        <h2 className="text-xl font-semibold mt-6 mb-2">
          3. How We Use Your Information
        </h2>
        <p className="mb-2">We use the information we collect to:</p>
        <ul className="list-disc list-inside space-y-1 mb-4">
          <li>Provide and operate the CoveCRM platform and features.</li>
          <li>
            Import and manage leads, contacts, conversations, and appointments.
          </li>
          <li>
            Process communications and lead data to provide requested features
            such as SMS follow-up, calling tools, appointment booking,
            AI-assisted messaging, AI dialer or virtual assistant features, AI
            call coaching, AI-generated summaries, and communication analysis.
          </li>
          <li>Process payments and manage subscriptions.</li>
          <li>Detect, prevent, and address technical or security issues.</li>
          <li>Respond to your requests and provide customer support.</li>
          <li>Improve and develop our products and services.</li>
        </ul>

        {/* 4. AI Processing */}
        <h2 className="text-xl font-semibold mt-6 mb-2">
          4. AI Processing
        </h2>
        <p className="mb-4">
          CoveCRM may provide AI-assisted features, including AI SMS Assistant,
          AI Dialer or Virtual Assistant, AI Call Coach, AI-generated summaries,
          call overviews, suggested follow-up, and analysis of customer
          communications. When you enable or use these features, communications,
          lead data, call recordings, transcripts, messages, notes, appointment
          information, and related metadata may be processed by CoveCRM and our
          AI service providers to provide the customer-requested functionality.
        </p>
        <p className="mb-4">
          AI features are intended to assist users with CRM workflows,
          communication organization, follow-up, summaries, and coaching.
          AI-generated content may be incomplete or inaccurate and should be
          reviewed by the user before relying on it or sending it externally.
        </p>
        <p className="mb-6">
          CoveCRM does not use customer lead data, communications, call
          recordings, transcripts, or Google user data to train generalized AI or
          machine learning models owned by CoveCRM.
        </p>

        {/* 5. Sharing & Disclosure */}
        <h2 className="text-xl font-semibold mt-6 mb-2">
          5. How We Share or Disclose Information
        </h2>
        <p className="mb-2">
          We do <span className="font-semibold">not</span> sell or rent your
          personal data or Google user data. We may share limited data only in
          these situations:
        </p>
        <ul className="list-disc list-inside space-y-1 mb-4">
          <li>
            <span className="font-semibold">Service providers:</span> We use
            third-party service providers to operate CoveCRM and deliver
            requested functionality. These may include payment processors such as
            Stripe; communications providers such as Twilio for SMS, voice,
            messaging, call routing, and related telecommunications services;
            Google for authentication and calendar integrations; OpenAI or other
            AI providers for AI-assisted features; Meta/Facebook for advertising
            integrations, Facebook Lead Ads, lead ingestion, attribution,
            reporting, and related advertising services; hosting,
            infrastructure, analytics, monitoring, and email service providers.
            These providers receive only the information reasonably necessary to
            perform services on our behalf and are required to protect that
            information.
          </li>
          <li>
            <span className="font-semibold">Meta/Facebook integrations:</span>{" "}
            If you connect Meta or Facebook features, CoveCRM may process
            information related to Facebook Lead Ads, lead forms, campaign
            performance, attribution, reporting, advertising accounts, pages,
            pixels, events, or related advertising integrations. This information
            is used to import leads, organize campaign activity, measure
            performance, and provide reporting or automation features requested
            by the user.
          </li>
          <li>
            <span className="font-semibold">Legal requirements:</span> We may
            disclose information if required by law, subpoena, or to protect our
            rights, users, or the public.
          </li>
          <li>
            <span className="font-semibold">Business transfers:</span> If we
            undergo a merger, acquisition, or asset sale, your information may
            be transferred as part of that transaction, subject to this policy.
          </li>
          <li>
            <span className="font-semibold">At your direction:</span> We may
            share or export your data when you request it (for example, when you
            export leads, download reports, or connect third-party tools to your
            CoveCRM account).
          </li>
        </ul>

        {/* 6. Data Security */}
        <h2 className="text-xl font-semibold mt-6 mb-2">6. Data Security</h2>
        <p className="mb-4">
          We implement reasonable technical and organizational measures—
          including encryption in transit, access controls, and audit logging—to
          protect your information. However, no platform can guarantee 100%
          security, and you are responsible for keeping your account credentials
          safe.
        </p>

        {/* 7. Data Retention */}
        <h2 className="text-xl font-semibold mt-6 mb-2">7. Data Retention</h2>
        <p className="mb-4">
          We retain personal information, lead data, communication records,
          appointment records, account records, billing records, and related
          metadata for as long as reasonably necessary to provide CoveCRM,
          maintain your account, comply with legal, tax, accounting,
          telecommunications, carrier, anti-abuse, dispute-resolution, and
          security obligations, and enforce our agreements.
        </p>
        <p className="mb-4">
          If you delete information from your account or close your account, we
          may delete or de-identify information in accordance with our normal
          retention practices, unless we need to retain it for legal, compliance,
          security, backup, fraud-prevention, dispute, or legitimate business
          purposes. Backup copies may persist for a limited period before being
          overwritten or deleted through normal backup cycles.
        </p>

        {/* 8. Data Rights */}
        <h2 className="text-xl font-semibold mt-6 mb-2">
          8. Your Rights (GDPR &amp; CCPA)
        </h2>
        <p className="mb-2">
          Depending on your location, you may have the right to access, correct,
          export, or delete your personal data, and to object to or restrict
          certain processing.
        </p>
        <p className="mb-4">
          To make a request, contact us at{" "}
          <a
            href="mailto:support@covecrm.com"
            className="text-blue-400 underline"
          >
            support@covecrm.com
          </a>
          . We will verify your request and respond as required by applicable
          law (including GDPR in the EU/EEA and CCPA/CPRA in California).
        </p>

        {/* 9. Changes */}
        <h2 className="text-xl font-semibold mt-6 mb-2">
          9. Changes to This Policy
        </h2>
        <p className="mb-4">
          We may update this Privacy Policy from time to time. If we make
          material changes, we will post the updated policy on this page and
          update the &quot;Effective Date&quot; above. Your continued use of
          CoveCRM after changes become effective means you agree to the updated
          policy.
        </p>

        {/* 10. Contact */}
        <h2 className="text-xl font-semibold mt-6 mb-2">
          10. Contact Us
        </h2>
        <p className="mb-2">
          If you have any questions about this Privacy Policy or how we handle
          your data, please contact us at:
        </p>
        <p className="mb-1">CoveCRM</p>
        <p className="mb-1">
          Email:{" "}
          <a
            href="mailto:support@covecrm.com"
            className="text-blue-400 underline"
          >
            support@covecrm.com
          </a>
        </p>
      </div>
    </div>
  );
}
