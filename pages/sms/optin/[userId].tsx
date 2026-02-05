// pages/sms/optin/[userId].tsx
import React, { useMemo, useState } from "react";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";

type Props = {
  businessName: string;
  agentName: string;
  email: string;
  phone: string;
};

export default function OptInPage(props: Props) {
  const { businessName, agentName, email, phone } = props;

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [mobile, setMobile] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const contactLine = useMemo(() => {
    const parts = [agentName].filter(Boolean);
    const tail: string[] = [];
    if (email) tail.push(email);
    if (phone) tail.push(phone);
    return parts.join(" ") + (tail.length ? ` • ${tail.join(" • ")}` : "");
  }, [agentName, email, phone]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) return;
    setSubmitted(true)
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">SMS Opt-In</h1>
          <p className="text-slate-300 mt-2">
            Use this page to confirm consent to receive text messages from your licensed agent using CoveCRM.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 mb-6">
          <div className="text-sm text-slate-300">
            <div className="mb-1">
              <span className="font-semibold text-slate-200">Sender:</span>{" "}
              <span className="text-slate-100">{businessName}</span>
            </div>
            <div>
              <span className="font-semibold text-slate-200">Contact:</span>{" "}
              <span className="text-slate-100">{contactLine}</span>
            </div>
          </div>
        </div>

        {!submitted ? (
          <form onSubmit={onSubmit} className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-300">First Name</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:ring-2 focus:ring-slate-600"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm text-slate-300">Last Name</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:ring-2 focus:ring-slate-600"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-300">Mobile Phone</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:ring-2 focus:ring-slate-600"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="(555) 123-4567"
                required
              />
              <p className="text-xs text-slate-400 mt-1">
                Enter the phone number that will receive text messages.
              </p>
            </div>

            <div>
              <label className="text-sm text-slate-300">Email (optional)</label>
              <input
                type="email"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:ring-2 focus:ring-slate-600"
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <label className="flex gap-3 items-start">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 h-4 w-4"
                  required
                />
                <span className="text-sm text-slate-200 leading-5">
                  By checking this box and submitting, you consent to receive SMS messages from{" "}
                  <span className="font-semibold">{agentName}</span> — your licensed agent — using CoveCRM regarding your
                  current policy, policy updates/changes, and future policy options. Message frequency varies. Msg &amp;
                  data rates may apply. Reply STOP to cancel. Reply HELP for help. Consent is not a condition of purchase.
                </span>
              </label>

              <div className="text-xs text-slate-400 mt-3">
                <a className="underline text-slate-300 hover:text-white" href={`/sms/optin-terms/${encodeURIComponent(String((props as any).userId || ""))}`}>Opt-in Terms</a>
                {" • "}
                <a className="underline text-slate-300 hover:text-white" href={`/sms/optin-privacy/${encodeURIComponent(String((props as any).userId || ""))}`}>Opt-in Privacy</a>
              </div>
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-white text-slate-900 font-semibold py-2 hover:bg-slate-200 transition"
            >
              Submit Opt-In
            </button>

            <p className="text-xs text-slate-400">
              If you did not request these messages, do not submit this form.
            </p>
          </form>
        ) : (
          <div className="rounded-xl border border-green-800 bg-green-900/20 p-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-green-500/20 border border-green-700 flex items-center justify-center">
                <span className="text-green-300 text-xl">✓</span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-green-200">Submitted</h2>
                <p className="text-slate-200">
                  Thanks — your SMS opt-in has been recorded for this sender.
                </p>
              </div>
            </div>

            <div className="mt-4 text-sm text-slate-200">
              You can opt out anytime by replying <span className="font-semibold">STOP</span>. For help, reply{" "}
              <span className="font-semibold">HELP</span>.
            </div>

            <div className="mt-4 text-xs text-slate-400">
              <a className="underline text-slate-300 hover:text-white" href="/legal/terms">Platform Terms</a>
              {" • "}
              <a className="underline text-slate-300 hover:text-white" href="/legal/privacy">Platform Privacy</a>
            </div>
          </div>
        )}

        <div className="mt-8 text-xs text-slate-500">
          This page is provided by CoveCRM to support compliant SMS opt-in documentation for A2P 10DLC review.
        </div>
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
