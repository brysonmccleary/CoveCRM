import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PhoneNumber from "@/models/PhoneNumber";
import { stripe } from "@/lib/stripe";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

type Json = Record<string, any>;

function normalizeE164(input: string): string {
  const d = (input || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return input.startsWith("+") ? input : `+${d}`;
}

async function tryCancelStripeSubscription(subscriptionId?: string | null) {
  if (!subscriptionId) return { canceled: false };
  try {
    await stripe.subscriptions.cancel(subscriptionId);
    return { canceled: true };
  } catch (e: any) {
    // Benign if already canceled/invalid; log and move on.
    console.warn("⚠️ Stripe subscription cancel warning:", e?.message || e);
    return { canceled: false, warn: String(e?.message || e) };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Json>) {
  // Accept DELETE (primary). Allow POST for clients that can’t send a body with DELETE.
  if (req.method !== "DELETE" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ ok: false, error: "Unauthorized" });

  // Allow body or query param
  const pnBody = (req.body as any)?.phoneNumber;
  const pnQuery = (req.query as any)?.phoneNumber;
  const rawPhoneParam = Array.isArray(pnBody) ? pnBody[0] : (pnBody ?? (Array.isArray(pnQuery) ? pnQuery[0] : pnQuery));
  if (!rawPhoneParam) return res.status(400).json({ ok: false, error: "Missing phone number" });

  const normalized = normalizeE164(String(rawPhoneParam));

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const numbers = Array.isArray(user.numbers) ? user.numbers : [];
    const entry = numbers.find((n: any) => n?.phoneNumber === normalized || n?.phoneNumber === String(rawPhoneParam));

    if (!entry) {
      // If it’s already gone from our account, return idempotent success.
      return res.status(200).json({
        ok: true,
        info: "Number not present on user; treated as released.",
        alreadyReleased: true,
        phoneNumber: normalized,
      });
    }

    // Twilio client for THIS user (subaccount-aware)
    const { client } = await getClientForUser(user.email);

    // Resolve number SID (prefer stored SID; fallback search)
    let numberSid: string | undefined = entry.sid;
    if (!numberSid) {
      const matches = await client.incomingPhoneNumbers.list({ phoneNumber: normalized, limit: 5 });
      if (matches.length > 0) numberSid = matches[0].sid;
    }

    // 1) Stop platform billing (if any)
    const stripeResult = await tryCancelStripeSubscription(entry.subscriptionId);

    // 2) Detach from Messaging Service (prefer known MS, else scan)
    let msDetachTried = false;
    let msDetached = false;
    try {
      if (numberSid) {
        if (entry.messagingServiceSid) {
          msDetachTried = true;
          try {
            await client.messaging.v1.services(entry.messagingServiceSid).phoneNumbers(numberSid).remove();
            msDetached = true;
          } catch {
            /* maybe not attached; ignore */
          }
        } else {
          // Fallback: scan a handful of services and attempt removal (idempotent)
          msDetachTried = true;
          const services = await client.messaging.v1.services.list({ limit: 50 });
          for (const svc of services) {
            try {
              await client.messaging.v1.services(svc.sid).phoneNumbers(numberSid).remove();
              msDetached = true;
            } catch {
              /* ignore if not linked */
            }
          }
        }
      }
    } catch (e: any) {
      console.warn("⚠️ Messaging Service detach warning:", e?.message || e);
    }

    // 3) Release number from Twilio (idempotent)
    let released = false;
    let releaseWarn: string | undefined;
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
    } catch (e: any) {
      // If it’s already gone, treat as success; otherwise carry a warning.
      const msg = String(e?.message || e || "");
      if (msg.toLowerCase().includes("resource not found") || msg.toLowerCase().includes("no record")) {
        released = true;
      } else {
        releaseWarn = msg;
        console.warn("⚠️ Twilio release warning:", msg);
      }
    }

    // 4) Local cleanup (always)
    user.numbers = numbers.filter(
      (n: any) => n?.phoneNumber !== normalized && n?.phoneNumber !== String(rawPhoneParam),
    );
    await user.save();

    try {
      await PhoneNumber.deleteOne({ userId: user._id, phoneNumber: normalized });
      await PhoneNumber.deleteOne({ userId: user._id, phoneNumber: String(rawPhoneParam) }); // belt & suspenders
    } catch (e: any) {
      console.warn("⚠️ PhoneNumber doc cleanup warning:", e?.message || e);
    }

    const payload: Json = {
      ok: true,
      phoneNumber: normalized,
      twilio: {
        released,
        numberSid: numberSid || null,
        msDetach: { tried: msDetachTried, detached: msDetached },
        ...(releaseWarn ? { warning: releaseWarn } : {}),
      },
      stripe: stripeResult,
      local: { removedFromUser: true },
    };

    return res.status(200).json(payload);
  } catch (err: any) {
    console.error("❌ Release number error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
