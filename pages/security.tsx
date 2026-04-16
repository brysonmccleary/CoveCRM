import Link from "next/link";

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-[#020617] text-white px-6 py-16">
      <div className="max-w-4xl mx-auto">

        <h1 className="text-4xl font-bold mb-6">Security & Data Protection</h1>

        <p className="text-slate-400 mb-10">
          CoveCRM is built with a focus on protecting user data, maintaining system reliability,
          and supporting compliant communication workflows.
        </p>

        {/* Infrastructure */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">Infrastructure</h2>
          <ul className="space-y-2 text-slate-400">
            <li>Secure cloud-hosted infrastructure</li>
            <li>Encrypted data transmission using HTTPS (TLS)</li>
            <li>Scalable backend architecture</li>
          </ul>
        </section>

        {/* Data Protection */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">Data Protection</h2>
          <ul className="space-y-2 text-slate-400">
            <li>Account-level data separation</li>
            <li>No cross-user data access</li>
            <li>Secure handling of lead and contact information</li>
          </ul>
        </section>

        {/* Communication Compliance */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">Communication Compliance</h2>
          <ul className="space-y-2 text-slate-400">
            <li>A2P 10DLC compliant messaging workflows</li>
            <li>Built-in opt-out and unsubscribe handling</li>
            <li>Designed for insurance and financial lead follow-up</li>
          </ul>
        </section>

        {/* Access Control */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">Access Control</h2>
          <ul className="space-y-2 text-slate-400">
            <li>Authenticated user access required</li>
            <li>Protected API routes</li>
            <li>System-level safeguards against unauthorized access</li>
          </ul>
        </section>

        {/* Company */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4">Company</h2>
          <p className="text-slate-400">
            CoveCRM is operated by Vault Commerce Group LLC and built by a professional development team.
          </p>
          <p className="text-slate-400 mt-2">
            Contact:{" "}
            <a href="mailto:support@covecrm.com" className="underline hover:text-white">
              support@covecrm.com
            </a>
          </p>
        </section>

        <div className="mt-12">
          <Link href="/" className="text-blue-400 hover:underline">
            ← Back to homepage
          </Link>
        </div>

      </div>
    </div>
  );
}
