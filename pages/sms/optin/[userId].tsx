// pages/sms/optin/[userId].tsx
import React from "react";
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
  return (
    <main style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1>SMS Opt-In Disclosure</h1>

      <p><strong>Sender:</strong> {businessName}</p>
      <p><strong>Contact:</strong> {agentName}{email ? ` • ${email}` : ""}{phone ? ` • ${phone}` : ""}</p>

      <h2>Disclosure</h2>
      <p>
        By submitting your information, you agree to receive SMS messages from <strong>{businessName}</strong> — <strong>your licensed agent</strong> using CoveCRM — regarding your current policy, policy updates/changes, and future policy options.
      </p>
      <ul>
        <li>Message frequency varies.</li>
        <li>Msg &amp; data rates may apply.</li>
        <li>Reply STOP to cancel.</li>
        <li>Reply HELP for help.</li>
      </ul>

      <p>
        <a href="/legal/terms">Terms</a> • <a href="/legal/privacy">Privacy</a>
      </p>
    </main>
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

  return { props: { businessName, agentName, email, phone } };
}
