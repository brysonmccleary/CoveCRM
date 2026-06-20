import React from "react";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { buildLeadGenerationSenderName } from "@/lib/a2p/flowSelection";

type Props = {
  businessName: string;
  agentName: string;
  email: string;
  phone: string;
  userId: string;
};

export default function LeadOptInTerms(props: Props) {
  const { businessName, agentName, email, phone, userId } = props;
  const senderName = buildLeadGenerationSenderName({ agentName, businessName });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">SMS Lead Opt-In Terms</h1>
        <p className="text-slate-300 mb-6">
          These terms apply when you choose to receive SMS messages after requesting information about life insurance,
          final expense coverage, mortgage protection, or related insurance options.
        </p>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 mb-6 text-sm text-slate-200">
          <div className="mb-1"><span className="font-semibold">Messages From:</span> {senderName}</div>
          <div><span className="font-semibold">Contact:</span> {agentName}{email ? ` • ${email}` : ""}{phone ? ` • ${phone}` : ""}</div>
        </div>

        <h2 className="text-xl font-semibold mt-6 mb-2">1. What You Are Opting Into</h2>
        <p className="text-slate-200 mb-4">
          If you opt in, you agree to receive SMS messages from <span className="font-semibold">{senderName}</span> about
          insurance information requests, life insurance, final expense, mortgage protection, appointment coordination,
          application follow-up, customer support, and responses to your requests.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">2. Message Frequency</h2>
        <p className="text-slate-200 mb-4">Message frequency varies based on your requests, appointments, and application activity.</p>

        <h2 className="text-xl font-semibold mt-6 mb-2">3. Charges</h2>
        <p className="text-slate-200 mb-4">Message and data rates may apply.</p>

        <h2 className="text-xl font-semibold mt-6 mb-2">4. Opt-Out and Help</h2>
        <ul className="list-disc list-inside space-y-2 text-slate-200 mb-4">
          <li>Reply <span className="font-semibold">STOP</span> to opt out at any time.</li>
          <li>Reply <span className="font-semibold">HELP</span> for help.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">5. Consent</h2>
        <p className="text-slate-200 mb-4">
          Consent is optional and is not a condition of purchase. You may request information or purchase insurance without agreeing to receive SMS messages.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">6. Privacy</h2>
        <p className="text-slate-200 mb-6">
          See the <a className="underline text-slate-300 hover:text-white" href={`/sms/lead-optin-privacy/${encodeURIComponent(userId)}`}>SMS Lead Opt-In Privacy</a> page
          for details about how mobile data and SMS consent are handled.
        </p>

        <div className="text-xs text-slate-500">
          <a className="underline text-slate-300 hover:text-white" href={`/sms/lead-optin/${encodeURIComponent(userId)}`}>Back to Opt-In</a>
          {" • "}
          <a className="underline text-slate-300 hover:text-white" href="/legal/terms">Platform Terms</a>
          {" • "}
          <a className="underline text-slate-300 hover:text-white" href="/legal/privacy">Platform Privacy</a>
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

  const businessName = String(a2p?.businessName || user?.name || "the insurance agency");
  const agentName =
    [a2p?.contactFirstName, a2p?.contactLastName].filter(Boolean).join(" ").trim() ||
    "";
  const email = String(a2p?.email || user?.email || "");
  const phone = String(a2p?.phone || "");

  return { props: { businessName, agentName, email, phone, userId } };
}
