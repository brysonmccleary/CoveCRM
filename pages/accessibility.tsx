import Link from "next/link";

export default function AccessibilityStatement() {
  return (
    <div className="min-h-screen bg-[#020617] text-white px-6 py-16">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold mb-6">Accessibility Statement</h1>

        <div className="space-y-6 text-slate-300 leading-7">
          <p>
            CoveCRM is committed to improving accessibility and usability for all users.
            We strive to follow WCAG 2.1 Level AA guidelines where applicable.
          </p>

          <p>
            We are continuing to improve the CoveCRM experience across our website and
            product so more people can access and use our tools effectively.
          </p>

          <p>
            If you experience difficulty accessing any part of CoveCRM, please contact
            us at{" "}
            <a href="mailto:support@covecrm.com" className="text-blue-400 underline hover:text-blue-300">
              support@covecrm.com
            </a>{" "}
            and include the page, feature, and issue you experienced.
          </p>
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
