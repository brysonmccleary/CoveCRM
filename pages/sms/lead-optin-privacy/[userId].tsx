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

export default function LeadOptInPrivacy(props: Props) {
  const { businessName, agentName, email, phone, userId } = props;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">SMS Lead Opt-In Privacy</h1>
        <p className="text-slate-300 mb-6">
          This notice explains how information is handled when you request information about life insurance,
          final expense coverage, mortgage protection, or related insurance options and choose to receive SMS messages.
        </p>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 mb-6 text-sm text-slate-200">
          <div className="mb-1"><span className="font-semibold">Sender:</span> {businessName}</div>
          <div><span className="font-semibold">Contact:</span> {agentName}{email ? ` • ${email}` : ""}{phone ? ` • ${phone}` : ""}</div>
        </div>

        <h2 className="text-xl font-semibold mt-6 mb-2">1. Information Collected</h2>
        <p className="text-slate-200 mb-4">
          We may collect your name, mobile phone number, optional email address, and information you submit with your insurance information request.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">2. How It Is Used</h2>
        <p className="text-slate-200 mb-4">
          Your information may be used to respond to your request, coordinate appointments, follow up on applications,
          provide customer support, and communicate about life insurance, final expense, mortgage protection, or related insurance options.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">3. Mobile Data Sharing</h2>
        <p className="text-slate-200 mb-4">
          We do not sell or share mobile opt-in data, mobile phone numbers, or SMS consent information with third parties,
          affiliates, or partners for marketing or promotional purposes. Mobile data may be shared with service providers only
          as needed to deliver SMS services and operate CoveCRM.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">4. Your Choices</h2>
        <ul className="list-disc list-inside space-y-2 text-slate-200 mb-6">
          <li>Reply <span className="font-semibold">STOP</span> to opt out of SMS messages.</li>
          <li>Reply <span className="font-semibold">HELP</span> for help.</li>
          <li>Message frequency varies. Message and data rates may apply.</li>
        </ul>

        <div className="text-xs text-slate-500">
          <a className="underline text-slate-300 hover:text-white" href={`/sms/lead-optin/${encodeURIComponent(userId)}`}>Back to Opt-In</a>
          {" • "}
          <a className="underline text-slate-300 hover:text-white" href={`/sms/lead-optin-terms/${encodeURIComponent(userId)}`}>SMS Terms</a>
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
