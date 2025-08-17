// pages/api/twilio/release-number.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PhoneNumber from "@/models/PhoneNumber";
import Stripe from "stripe";
import twilioClient from "@/lib/twilioClient";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

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

  const { phoneNumber } = req.body as { phoneNumber?: string };
  if (!phoneNumber) return res.status(400).json({ message: "Missing phone number" });

  const normalizedPhone = normalizeE164(phoneNumber);

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user || !user.numbers) {
      return res.status(404).json({ message: "User or number not found" });
    }

    // Find the number entry on the user
    const target = user.numbers.find((n: any) => n.phoneNumber === normalizedPhone || n.phoneNumber === phoneNumber);
    if (!target) return res.status(404).json({ message: "Number not found in user's account" });

    // 0) Look up the Twilio number SID if we don't have it on the user doc
    let numberSid: string | undefined = target.sid;
    if (!numberSid) {
      const matches = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: normalizedPhone, limit: 5 });
      if (matches && matches.length > 0) numberSid = matches[0].sid;
    }

    // 1) Cancel Stripe subscription (if any)
    try {
      if (target.subscriptionId) {
        await stripe.subscriptions.del(target.subscriptionId);
      }
    } catch (err) {
      console.warn("⚠️ Stripe subscription cancel warning:", err);
      // continue; we still want to free the number
    }

    // 2) Unlink from ANY Messaging Service sender pool (so this number can be reused)
    if (numberSid) {
      try {
        const services = await twilioClient.messaging.v1.services.list({ limit: 100 });
        for (const svc of services) {
          try {
            await twilioClient.messaging.v1.services(svc.sid).phoneNumbers(numberSid).remove();
            // If it wasn't linked, Twilio throws — we ignore and keep going
          } catch {}
        }
      } catch (err) {
        console.warn("⚠️ Failed to enumerate/remove number from services:", err);
      }
    }

    // 3) Release number in Twilio (free it)
    try {
      if (numberSid) {
        await twilioClient.incomingPhoneNumbers(numberSid).remove();
      } else {
        // Fallback: try to find and remove by listing if SID still missing
        const matches = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: normalizedPhone, limit: 5 });
        if (matches && matches.length > 0) {
          await twilioClient.incomingPhoneNumbers(matches[0].sid).remove();
        }
      }
    } catch (err) {
      console.warn("⚠️ Twilio number release warning:", err);
      // continue; we still want to clean local state
    }

    // 4) Remove from user.numbers[]
    user.numbers = user.numbers.filter((n: any) => n.phoneNumber !== normalizedPhone && n.phoneNumber !== phoneNumber);
    await user.save();

    // 5) Remove from PhoneNumber collection (tidy)
    try {
      await PhoneNumber.deleteOne({ userId: user._id, phoneNumber: normalizedPhone });
      await PhoneNumber.deleteOne({ userId: user._id, phoneNumber }); // in case it was stored non-normalized
    } catch (err) {
      console.warn("⚠️ PhoneNumber doc delete warning:", err);
    }

    return res.status(200).json({ message: "Number released, unlinked, and billing cancelled" });
  } catch (err: any) {
    console.error("Release number error:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
}
