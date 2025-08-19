// /pages/api/numbers/assign.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import twilioClient from "@/lib/twilioClient";
import User from "@/models/User";
import PhoneNumber from "@/models/PhoneNumber";

/**
 * Secure per-user assignment:
 * POST { phoneNumbers: string[] }  // E.164 list, e.g. ["+16232947974","+15594842175"]
 *
 * - Only assigns numbers to the CURRENT LOGGED-IN USER.
 * - Verifies each number exists in your Twilio account.
 * - If a PhoneNumber doc already exists with a different owner, we flag it as conflict.
 * - If it exists with the same owner, we mark it as alreadyOwned.
 * - If it doesn't exist, we create it and tie to this user.
 *
 * This is safe for multi-tenant. No cross-user leakage.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { phoneNumbers } = req.body as { phoneNumbers?: string[] };
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
    return res.status(400).json({ message: "Provide phoneNumbers: string[]" });
  }

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Pull Twilio numbers to validate ownership (index by E.164)
    const twilioList = await twilioClient.incomingPhoneNumbers.list({ limit: 200 });
    const twilioByE164 = new Map<string, (typeof twilioList)[number]>();
    for (const t of twilioList) if (t.phoneNumber) twilioByE164.set(t.phoneNumber, t);

    const created: string[] = [];
    const alreadyOwned: string[] = [];
    const conflicts: { phoneNumber: string; ownerUserId: string }[] = [];
    const notFound: string[] = [];

    for (const raw of phoneNumbers) {
      const phone = (raw || "").trim();
      if (!phone.startsWith("+")) {
        // Expect E.164 format
        notFound.push(phone);
        continue;
      }

      const t = twilioByE164.get(phone);
      if (!t) {
        notFound.push(phone);
        continue;
      }

      const existing = await PhoneNumber.findOne({ phoneNumber: phone });
      if (existing) {
        if (existing.userId.toString() === user._id.toString()) {
          // already tied to this user — ensure Twilio SID is up to date
          if (!existing.twilioSid || existing.twilioSid !== t.sid) {
            existing.twilioSid = t.sid;
            await existing.save();
          }
          alreadyOwned.push(phone);
        } else {
          // owned by someone else — do not steal
          conflicts.push({ phoneNumber: phone, ownerUserId: existing.userId.toString() });
        }
        continue;
      }

      // Create assignment for this user
      await PhoneNumber.create({
        userId: user._id,
        phoneNumber: phone,
        twilioSid: t.sid,
        datePurchased: new Date(),
        a2pApproved: true,
      });
      created.push(phone);
    }

    return res.status(200).json({
      message: "Assignment complete",
      created,
      alreadyOwned,
      conflicts,
      notFound,
    });
  } catch (err: any) {
    console.error("❌ /api/numbers/assign error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
}
