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

  // Accept phone number from body OR query (DELETE may not include a body)
  const pnFromBody = (req.body as any)?.phoneNumber;
  const pnFromQuery = (req.query as any)?.phoneNumber;
  const rawPhoneParam = Array.isArray(pnFromBody) ? pnFromBody[0] :
                        pnFromBody ?? (Array.isArray(pnFromQuery) ? pnFromQuery[0] : pnFromQuery);

  if (!rawPhoneParam) return res.status(400).json({ message: "Missing phone number" });

  const normalized = normalizeE164(String(rawPhoneParam));

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const entry = (user.numbers || []).find(
      (n: any) => n.phoneNumber === normalized || n.phoneNumber === rawPhoneParam,
    );
    if (!entry) return res.status(404).json({ message: "Number not found in your account" });

    // Always act in THIS user’s Twilio account (platform or personal)
    const { client } = await getClientForUser(user.email);

    // Resolve number SID (prefer stored SID; fall back to Twilio lookup)
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

    // 2) Detach from any Messaging Service in THIS account (idempotent)
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

    // 3) Release from Twilio (stops Twilio billing for personal/self-billed)
    let released = false;
    try {
      if (numberSid) {
        await client.incomingPhoneNumbers(numberSid).remove();
        released = true;
      } else {
        const matches = await client.incomingPhoneNumbers.list({ phoneNumber: normalized, limit: 5 });
        if (matches.length > 0) {
          await client.incomingPhoneNumbers(matches[0].sid).remove();
          released = true;
        }
      }
    } catch (e) {
      console.warn("⚠️ Twilio release warning (continuing):", e);
      // Optional: hook your alerting here (Sentry/LogTail/etc.)
      // captureException(e, { extra: { phoneNumber: normalized, userEmail: user.email } });
    }

    if (!released) {
      console.warn(
        `⚠️ Twilio release could not confirm removal for ${normalized} (user=${user.email}). Continuing local cleanup.`,
      );
    }

    // 4) Remove from user doc
    user.numbers = (user.numbers || []).filter(
      (n: any) => n.phoneNumber !== normalized && n.phoneNumber !== String(rawPhoneParam),
    );
    await user.save();

    // 5) Tidy PhoneNumber doc
    try {
      await PhoneNumber.deleteOne({ userId: user._id, phoneNumber: normalized });
      await PhoneNumber.deleteOne({ userId: user._id, phoneNumber: String(rawPhoneParam) }); // just in case
    } catch (e) {
      console.warn("⚠️ PhoneNumber delete warning:", e);
    }

    return res.status(200).json({ ok: true, message: "Number released and billing stopped." });
  } catch (err: any) {
    console.error("Release number error:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
}
