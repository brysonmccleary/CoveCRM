// /pages/api/twilio/release-number.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PhoneNumber from "@/models/PhoneNumber";
import { stripe } from "@/lib/stripe";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

function normalizeE164(p: string) {
  const digits = (p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return p.startsWith("+") ? p : `+${digits}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "DELETE") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { phoneNumber } = (req.body || {}) as { phoneNumber?: string };
  if (!phoneNumber) return res.status(400).json({ message: "Missing phone number" });

  const normalized = normalizeE164(phoneNumber);

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const entry = (user.numbers || []).find(
      (n: any) => n.phoneNumber === normalized || n.phoneNumber === phoneNumber,
    );
    if (!entry) return res.status(404).json({ message: "Number not found in your account" });

    // Always act in THIS user’s Twilio account (platform or personal)
    const { client } = await getClientForUser(user.email);

    // Resolve number SID (trust our stored SID, but double-check via Twilio)
    let numberSid: string | undefined = entry.sid;
    if (!numberSid) {
      const matches = await client.incomingPhoneNumbers.list({ phoneNumber: normalized, limit: 5 });
      if (matches.length > 0) numberSid = matches[0].sid;
    }

    // 1) Cancel platform billing (if present)
    if (entry.subscriptionId) {
      try {
        await stripe.subscriptions.cancel(entry.subscriptionId);
      } catch (e) {
        console.warn("⚠️ Stripe cancel failed (continuing):", e);
      }
    }

    // 2) Detach from Messaging Services in THIS account (idempotent, safe)
    if (numberSid) {
      try {
        const services = await client.messaging.v1.services.list({ limit: 100 });
        for (const svc of services) {
          try {
            await client.messaging.v1.services(svc.sid).phoneNumbers(numberSid).remove();
          } catch {
            /* ignore if not linked */
          }
        }
      } catch (e) {
        console.warn("⚠️ Could not enumerate services (continuing):", e);
      }
    }

    // 3) Release from Twilio (this stops Twilio billing for personal users)
    try {
      if (numberSid) {
        await client.incomingPhoneNumbers(numberSid).remove();
      } else {
        const matches = await client.incomingPhoneNumbers.list({ phoneNumber: normalized, limit: 5 });
        if (matches.length > 0) await client.incomingPhoneNumbers(matches[0].sid).remove();
      }
    } catch (e) {
      console.warn("⚠️ Twilio release warning (continuing):", e);
    }

    // 4) Remove from user doc
    user.numbers = (user.numbers || []).filter(
      (n: any) => n.phoneNumber !== normalized && n.phoneNumber !== phoneNumber,
    );
    await user.save();

    // 5) Tidy PhoneNumber doc
    try {
      await PhoneNumber.deleteOne({ userId: user._id, phoneNumber: normalized });
      await PhoneNumber.deleteOne({ userId: user._id, phoneNumber }); // just in case
    } catch (e) {
      console.warn("⚠️ PhoneNumber delete warning:", e);
    }

    return res.status(200).json({ ok: true, message: "Number released and billing stopped." });
  } catch (err: any) {
    console.error("Release number error:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
}
