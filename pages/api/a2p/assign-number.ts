// /pages/api/a2p/assign-number.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PhoneNumber from "@/models/PhoneNumber";
import A2PProfile from "@/models/A2PProfile";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

type Body = {
  phoneNumber: string; // E.164
  messagingServiceSid?: string; // optional override; else use per-user A2PProfile.ms
};

function log(...args: any[]) {
  console.log("[A2P assign-number]", ...args);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email)
      return res.status(401).json({ message: "Unauthorized" });

    await mongooseConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Resolve Twilio client in the *user subaccount* (or self-billing creds)
    const resolved = await getClientForUser(session.user.email);
    const client = resolved.client;
    const twilioAccountSidUsed = resolved.accountSid;

    log("twilioAccountSidUsed", { twilioAccountSidUsed });

    const { phoneNumber, messagingServiceSid: overrideMs } = (req.body || {}) as Body;
    if (!phoneNumber || !phoneNumber.startsWith("+")) {
      return res.status(400).json({
        message: "Provide phoneNumber in E.164 format, e.g. +14155551234",
      });
    }

    // Resolve A2P profile / Messaging Service
    const a2p = await A2PProfile.findOne({ userId: String(user._id) });
    const msSid = overrideMs || a2p?.messagingServiceSid;
    if (!msSid) {
      return res.status(400).json({
        message: "No Messaging Service for this user. Run /api/a2p/start first.",
      });
    }

    // 1) Find the IncomingPhoneNumber SID for this number (must be owned by the Twilio account)
    const owned = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
    if (!owned || owned.length === 0) {
      return res.status(404).json({
        message: "This Twilio account does not own the provided phone number.",
        twilioAccountSidUsed,
      });
    }
    const incoming = owned[0]; // PN SID
    const pnSid = (incoming as any).sid;

    // 2) Check if already attached to the Messaging Service
    const attachedList = await client.messaging.v1.services(msSid).phoneNumbers.list({ limit: 100 });
    const already = attachedList.find((p: any) => p.phoneNumberSid === pnSid);

    if (!already) {
      await client.messaging.v1.services(msSid).phoneNumbers.create({ phoneNumberSid: pnSid });
    }

    // 3) Persist ownership in User & PhoneNumber models (idempotent upserts)
    const normalizedE164 = phoneNumber;

    const idx = (user.numbers || []).findIndex((n) => n.phoneNumber === normalizedE164);
    if (idx >= 0) {
      user.numbers![idx].messagingServiceSid = msSid;
      user.numbers![idx].sid = pnSid;
      if (!user.numbers![idx].friendlyName && (incoming as any).friendlyName) {
        user.numbers![idx].friendlyName = (incoming as any).friendlyName;
      }
    } else {
      user.numbers = user.numbers || [];
      user.numbers.push({
        phoneNumber: normalizedE164,
        sid: pnSid,
        messagingServiceSid: msSid,
        purchasedAt: new Date((incoming as any).dateCreated || Date.now()),
        friendlyName: (incoming as any).friendlyName || undefined,
        status: "active",
        capabilities: {
          voice: (incoming as any).capabilities?.voice ?? undefined,
          sms: (incoming as any).capabilities?.SMS ?? (incoming as any).capabilities?.sms ?? undefined,
          mms: (incoming as any).capabilities?.MMS ?? (incoming as any).capabilities?.mms ?? undefined,
        },
        country: (incoming as any).countryCode || undefined,
        carrier: undefined,
      } as any);
    }
    await user.save();

    await PhoneNumber.updateOne(
      { phoneNumber: normalizedE164 },
      {
        $set: {
          userId: user._id,
          phoneNumber: normalizedE164,
          messagingServiceSid: msSid,
          twilioSid: pnSid,
          friendlyName: (incoming as any).friendlyName || undefined,
          a2pApproved: Boolean(a2p?.messagingReady),
        },
      },
      { upsert: true },
    );

    // 4) Return consolidated sender state
    const sender = await client.messaging.v1.services(msSid).phoneNumbers(pnSid).fetch();
    const a2pReady = Boolean(a2p?.messagingReady);

    return res.status(200).json({
      ok: true,
      phoneNumber: normalizedE164,
      phoneNumberSid: pnSid,
      messagingServiceSid: msSid,
      campaignSid: (a2p as any)?.usa2pSid || a2p?.campaignSid || null,
      a2pReady,
      senderStatus: {
        sid: (sender as any).sid,
        countryCode: (sender as any).countryCode ?? undefined,
        dateCreated: (sender as any).dateCreated ?? undefined,
      },
      note: a2pReady
        ? "Number attached and ready to send under approved A2P campaign."
        : "Number attached. A2P not yet approved—messages may be restricted until approval completes.",
      twilioAccountSidUsed,
    });
  } catch (err: any) {
    console.error("A2P assign-number error:", err);
    return res.status(500).json({
      message: err?.message || "Failed to assign number",
    });
  }
}
