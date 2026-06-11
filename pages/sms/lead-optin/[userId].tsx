import React, { useMemo, useState } from "react";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";

type Props = {
  businessName: string;
  agentName: string;
  email: string;
  phone: string;
  userId: string;
};

const CONSENT_TEXT =
  "By checking this box, you agree to receive SMS messages about life insurance, final expense coverage, mortgage protection, related insurance options, appointment coordination, application follow-up, customer support, and responses to your requests. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase.";

export default function LeadOptInPage(props: Props) {
  const { businessName, agentName, email, phone, userId } = props;
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [mobile, setMobile] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const contactLine = useMemo(() => {
    const tail: string[] = [];
    if (agentName) tail.push(agentName);
    if (email) tail.push(email);
    if (phone) tail.push(phone);
    return tail.join(" • ");
  }, [agentName, email, phone]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!consent) {
      setError("Please check the SMS consent box to opt in to text messages.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sms/lead-optin/${encodeURIComponent(userId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          phone: mobile,
          email: leadEmail,
          consentGiven: consent,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Unable to submit right now.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Insurance SMS Opt-In</h1>
          <p className="text-slate-300 mt-2">
            Use this page to opt in to SMS messages about life insurance, final expense coverage,
            mortgage protection, related insurance information requests, appointment coordination,
            application follow-up, and customer support.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 mb-6 text-sm text-slate-300">
          <div className="mb-1"><span className="font-semibold text-slate-200">Business:</span> {businessName}</div>
          <div className="mb-1"><span className="font-semibold text-slate-200">Representative:</span> {agentName}</div>
          {contactLine && <div><span className="font-semibold text-slate-200">Contact:</span> {contactLine}</div>}
        </div>

        {!submitted ? (
          <form onSubmit={onSubmit} className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-300">First Name</label>
                <input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:ring-2 focus:ring-slate-600" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div>
                <label className="text-sm text-slate-300">Last Name</label>
                <input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:ring-2 focus:ring-slate-600" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-300">Mobile Phone</label>
              <input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:ring-2 focus:ring-slate-600" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="(555) 123-4567" required />
            </div>

            <div>
              <label className="text-sm text-slate-300">Email (optional)</label>
              <input type="email" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:ring-2 focus:ring-slate-600" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} placeholder="name@example.com" />
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <label className="flex gap-3 items-start">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" />
                <span className="text-sm text-slate-200 leading-5">
                  {CONSENT_TEXT}
                </span>
              </label>
              <div className="text-xs text-slate-400 mt-3">
                <a className="underline text-slate-300 hover:text-white" href={`/sms/lead-optin-terms/${encodeURIComponent(userId)}`}>SMS Terms</a>
                {" • "}
                <a className="underline text-slate-300 hover:text-white" href={`/sms/lead-optin-privacy/${encodeURIComponent(userId)}`}>SMS Privacy</a>
              </div>
            </div>

            {error && <p className="text-sm text-red-300">{error}</p>}

            <button type="submit" disabled={submitting} className="w-full rounded-lg bg-white text-slate-900 font-semibold py-2 hover:bg-slate-200 transition disabled:opacity-60">
              {submitting ? "Submitting..." : "Submit Opt-In"}
            </button>
          </form>
        ) : (
          <div className="rounded-xl border border-green-800 bg-green-900/20 p-6">
            <h2 className="text-xl font-bold text-green-200">Submitted</h2>
            <p className="text-slate-200 mt-2">Thanks. Your SMS opt-in has been recorded for this sender.</p>
            <div className="mt-4 text-sm text-slate-200">
              You can opt out anytime by replying <span className="font-semibold">STOP</span>. For help, reply <span className="font-semibold">HELP</span>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export async function getServerSideProps(ctx: any) {
  const userId = String(ctx?.params?.userId || "");
  await mongooseConnect();

  const user = await User.findById(userId).lean<any>();
  const a2p = await A2PProfile.findOne({ userId }).lean<any>();

  const businessName = String(a2p?.businessName || user?.name || "Business");
  const agentName =
    [a2p?.contactFirstName, a2p?.contactLastName].filter(Boolean).join(" ").trim() ||
    String(user?.name || "Authorized Representative");

  const email = String(a2p?.email || user?.email || "");
  const phone = String(a2p?.phone || "");

  return { props: { businessName, agentName, email, phone, userId } };
}
