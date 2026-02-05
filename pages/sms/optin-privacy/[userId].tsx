// pages/sms/optin-privacy/[userId].tsx
import React from "react";
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

export default function OptInPrivacy(props: Props) {
  const { businessName, agentName, email, phone, userId } = props;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">SMS Opt-In Privacy</h1>
        <p className="text-slate-300 mb-6">
          This privacy notice explains how information is handled when you opt in to receive SMS messages from your licensed agent using CoveCRM.
        </p>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 mb-6 text-sm text-slate-200">
          <div className="mb-1"><span className="font-semibold">Sender:</span> {businessName}</div>
          <div><span className="font-semibold">Contact:</span> {agentName}{email ? ` • ${email}` : ""}{phone ? ` • ${phone}` : ""}</div>
        </div>

        <h2 className="text-xl font-semibold mt-6 mb-2">1. Information Collected</h2>
        <p className="text-slate-200 mb-4">
          When you submit the SMS opt-in form, information you enter may include your name, mobile phone number, and optionally email address.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">2. How It’s Used</h2>
        <p className="text-slate-200 mb-4">
          This information is used to document consent and to enable policy-related messaging such as current policy communications,
          policy updates/changes, and future policy options.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">3. Sharing</h2>
        <p className="text-slate-200 mb-4">
          CoveCRM does not sell your personal information. Data may be processed by service providers used to deliver SMS services (e.g., Twilio)
          and to host CoveCRM. Providers receive only what is necessary to perform their services and are required to protect the data.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">4. Retention</h2>
        <p className="text-slate-200 mb-4">
          Consent records may be retained as needed for compliance and audit purposes.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">5. Your Choices</h2>
        <ul className="list-disc list-inside space-y-2 text-slate-200 mb-6">
          <li>Opt out anytime by replying <span className="font-semibold">STOP</span>.</li>
          <li>For help, reply <span className="font-semibold">HELP</span>.</li>
          <li>To request access or deletion, contact support at <a className="underline text-slate-300 hover:text-white" href="mailto:support@covecrm.com">support@covecrm.com</a>.</li>
        </ul>

        <div className="text-xs text-slate-500">
          <a className="underline text-slate-300 hover:text-white" href={`/sms/optin/${encodeURIComponent(userId)}`}>Back to Opt-In</a>
          {" • "}
          <a className="underline text-slate-300 hover:text-white" href={`/sms/optin-terms/${encodeURIComponent(userId)}`}>Opt-in Terms</a>
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

  const businessName = String(a2p?.businessName || user?.name || "Business");
  const agentName =
    [a2p?.contactFirstName, a2p?.contactLastName].filter(Boolean).join(" ").trim() ||
    String(user?.name || "Authorized Representative");

  const email = String(a2p?.email || user?.email || "");
  const phone = String(a2p?.phone || "");

  return { props: { businessName, agentName, email, phone, userId } };
}
