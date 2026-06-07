// /pages/legal/cookies.tsx
export default function CookiePolicy() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Cookie Policy</h1>
        <p className="mb-4">Effective Date: July 22, 2025</p>

        <p className="mb-6">
          Cove CRM (&quot;CoveCRM&quot;, &quot;we&quot;, &quot;us&quot;, or
          &quot;our&quot;) uses cookies and similar technologies to operate
          covecrm.com and related services, keep users signed in, remember
          preferences, protect the platform, and understand how visitors use our
          website.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          1. What Cookies Are
        </h2>
        <p className="mb-4">
          Cookies are small text files stored on your device by your browser.
          They help websites remember information about your visit, such as your
          session, preferences, or how you interact with pages.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          2. Cookies We Use
        </h2>
        <p className="mb-2">
          We may use the following types of cookies and similar technologies:
        </p>
        <ul className="list-disc list-inside space-y-2 mb-4">
          <li>
            <span className="font-semibold">Essential cookies:</span> These are
            needed for the website and platform to function properly.
          </li>
          <li>
            <span className="font-semibold">
              Authentication and session cookies:
            </span>{" "}
            These help keep you signed in, manage your session, and recognize
            your account while you use CoveCRM.
          </li>
          <li>
            <span className="font-semibold">Security cookies:</span> These help
            protect the platform, detect suspicious activity, and support
            account and service security.
          </li>
          <li>
            <span className="font-semibold">Preference cookies:</span> These may
            remember choices you make so the service can provide a more
            consistent experience.
          </li>
          <li>
            <span className="font-semibold">Analytics cookies:</span> These help
            us understand how visitors use our website so we can improve the
            experience and performance of CoveCRM.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          3. Microsoft Clarity
        </h2>
        <p className="mb-4">
          CoveCRM uses Microsoft Clarity for website analytics and user-behavior
          insights. Microsoft Clarity may collect information about how visitors
          interact with our website, such as pages visited, clicks, scrolling,
          session activity, device and browser information, and general usage
          patterns. We use this information to understand website performance,
          improve user experience, and identify areas of the site that may need
          improvement.
        </p>
        <p className="mb-4">
          Microsoft Clarity may use cookies or similar technologies to provide
          analytics. Information processed through Microsoft Clarity is handled
          according to Microsoft&apos;s applicable terms and privacy practices.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          4. Third-Party Service Providers
        </h2>
        <p className="mb-4">
          We may allow service providers, including Microsoft Clarity and
          hosting or infrastructure providers, to use cookies or similar
          technologies as needed to provide analytics, operate the website,
          maintain security, and deliver CoveCRM services. These providers
          receive information only as needed to perform services on our behalf.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          5. How You Can Control Cookies
        </h2>
        <p className="mb-4">
          You can control or block cookies through your browser settings. Most
          browsers allow you to delete existing cookies, block new cookies, or
          receive alerts before cookies are stored. If you disable certain
          cookies, some parts of CoveCRM may not function properly, including
          login, session, security, or preference features.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          6. Updates to This Policy
        </h2>
        <p className="mb-4">
          We may update this Cookie Policy from time to time. If we make
          material changes, we will post the updated policy on this page and
          update the &quot;Effective Date&quot; above.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">
          California Privacy Notice
        </h2>
        <p className="mb-4">
          California residents may have rights under the California Consumer
          Privacy Act (CCPA) and California Privacy Rights Act (CPRA).
          Information regarding these rights and how to exercise them is
          available in our Privacy Policy.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">7. Contact Us</h2>
        <p className="mb-2">
          If you have any questions about this Cookie Policy, please contact us
          at:
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
