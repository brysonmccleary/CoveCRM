// /pages/api/numbers/sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import twilioClient from "@/lib/twilioClient";
import User from "@/models/User";
import PhoneNumber from "@/models/PhoneNumber";
// Legacy ownership collection (email-based)
import LegacyNumber from "@/models/number";

/**
 * Sync logic:
 * 1) Load signed-in user.
 * 2) Try PhoneNumber (userId-based) ownership. If none, FALL BACK to legacy `numbers` by userEmail
 *    and auto-migrate those into PhoneNumber (userId + phoneNumber).
 * 3) Fetch Twilio IncomingPhoneNumbers and map by E.164 + SID.
 * 4) Upsert each owned Twilio number into user.numbers[] while preserving subscriptionId/usage.
 * 5) Save user; return merged list (only numbers that still exist on Twilio).
 *
 * Notes:
 * - Does not touch Stripe or create subscriptions.
 * - Does not attach to Messaging Service here. (We can add later once you confirm per-user service.)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    await dbConnect();

    // 1) Signed-in user
    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // 2) Ownership: preferred = PhoneNumber (userId). If empty, migrate from legacy `numbers` by userEmail.
    let owned = await PhoneNumber.find({ userId: user._id }).lean();

    if (!owned || owned.length === 0) {
      // Look for legacy docs by userEmail (e.g., { phoneNumber, twilioSid, userEmail })
      const legacy = await LegacyNumber.find({ userEmail: user.email }).lean();

      if (legacy && legacy.length > 0) {
        // Migrate each legacy doc into PhoneNumber (idempotent)
        for (const l of legacy) {
          const exists = await PhoneNumber.findOne({ phoneNumber: l.phoneNumber });
          if (!exists) {
            await PhoneNumber.create({
              userId: user._id,
              phoneNumber: l.phoneNumber,
              twilioSid: l.twilioSid, // optional legacy field
              datePurchased: new Date(),
              a2pApproved: true, // legacy numbers likely intended for A2P use
            });
          }
        }
        // reload owned after migration
        owned = await PhoneNumber.find({ userId: user._id }).lean();
      }
    }

    // If after fallback there is still nothing, return empty.
    if (!owned || owned.length === 0) {
      return res.status(200).json({ numbers: [] });
    }

    // 3) Fetch Twilio IncomingPhoneNumbers (your account)
    const twilioList = await twilioClient.incomingPhoneNumbers.list({ limit: 100 });

    // Index for quick lookup
    const byE164 = new Map<string, (typeof twilioList)[number]>();
    const bySid = new Map<string, (typeof twilioList)[number]>();
    for (const n of twilioList) {
      if (n.phoneNumber) byE164.set(n.phoneNumber, n);
      if (n.sid) bySid.set(n.sid, n);
    }

    // Ensure array exists
    user.numbers = user.numbers || [];

    // Helper to find an entry in user.numbers by SID or phoneNumber
    const findUserNumberIndex = (sid?: string, phone?: string) => {
      return user.numbers!.findIndex((u) => {
        if (sid && u.sid === sid) return true;
        if (phone && u.phoneNumber === phone) return true;
        return false;
      });
    };

    // 4) Reconcile each owned number that still exists in Twilio
    for (const doc of owned) {
      const phone = doc.phoneNumber;
      const t = byE164.get(phone) || (doc.twilioSid ? bySid.get(doc.twilioSid) : undefined);

      // If the number isn't in Twilio anymore, skip it (likely released)
      if (!t) continue;

      // Backfill PhoneNumber.twilioSid if missing or changed
      if (!doc.twilioSid || doc.twilioSid !== t.sid) {
        await PhoneNumber.updateOne({ _id: doc._id }, { $set: { twilioSid: t.sid } });
      }

      // Upsert into user.numbers[]
      const idx = findUserNumberIndex(t.sid, phone);
      if (idx === -1) {
        user.numbers.push({
          sid: t.sid,
          phoneNumber: t.phoneNumber!,
          usage: {
            callsMade: 0,
            callsReceived: 0,
            textsSent: 0,
            textsReceived: 0,
            cost: 0,
          },
        });
      } else {
        // Refresh SID/phoneNumber but keep subscriptionId/usage
        user.numbers[idx].sid = t.sid;
        user.numbers[idx].phoneNumber = t.phoneNumber!;
      }
    }

    // 5) Save and build final list (only numbers that still exist on Twilio)
    await user.save();

    const merged = (user.numbers || [])
      .filter((n) => bySid.has(n.sid) || byE164.has(n.phoneNumber))
      .map((n) => ({
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        subscriptionId: n.subscriptionId || null,
        usage: n.usage || {
          callsMade: 0,
          callsReceived: 0,
          textsSent: 0,
          textsReceived: 0,
          cost: 0,
        },
      }));

    return res.status(200).json({ numbers: merged });
  } catch (err: any) {
    console.error("❌ /api/numbers/sync error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
}
