import Link from "next/link";

export default function AccessibilityStatement() {
  return (
    <div className="min-h-screen bg-[#020617] text-white px-6 py-16">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold mb-6">Accessibility Statement</h1>

        <div className="space-y-10 text-slate-300 leading-7">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Our Commitment</h2>
            <p>
              CoveCRM is committed to providing a simple, usable, and accessible
              experience for all users. We want agents, teams, and visitors to be able
              to navigate CoveCRM with clarity and confidence.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Accessibility Standards</h2>
            <p>
              We strive to follow WCAG 2.1 Level AA guidelines where applicable. These
              standards help guide how we evaluate page structure, text contrast,
              keyboard access, forms, buttons, links, and other important interface
              elements.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">What We Are Working Toward</h2>
            <p>
              Our goal is to make navigation, buttons, forms, links, and core CRM
              workflows clear and usable. We continue to review the CoveCRM website and
              product experience so we can improve readability, interaction patterns,
              and access to key features over time.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Third-Party Services</h2>
            <p>
              CoveCRM may connect to third-party services such as payment, calendar,
              communications, analytics, or advertising tools. Some third-party
              services may be outside our direct control, but we aim to connect users
              to the correct destination and improve accessibility where possible.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Feedback and Support</h2>
            <p>
              If you experience difficulty accessing any part of CoveCRM, please contact
              us at{" "}
              <a href="mailto:support@covecrm.com" className="text-blue-400 underline hover:text-blue-300">
                support@covecrm.com
              </a>{" "}
              and include the page, feature, device/browser, and issue you experienced.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-3">Ongoing Improvements</h2>
            <p>
              Accessibility is an ongoing effort. As CoveCRM grows, we will continue
              working to improve usability, address reported issues, and make the
              product easier to use for more people.
            </p>
          </section>
        </div>

        <div className="mt-12">
          <Link href="/" className="text-blue-400 hover:underline">
            Back to homepage
          </Link>
        </div>
      </div>
    </div>
  );
}
