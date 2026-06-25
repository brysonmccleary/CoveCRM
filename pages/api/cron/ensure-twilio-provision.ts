import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { ensureUserTwilioIdentity, provisionUserTwilio } from "@/lib/twilio/provision";
import { checkCronAuth } from "@/lib/cronAuth";
import { isAdmin } from "@/lib/featureFlags";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ✅ Auth gate (Bearer header OR ?token)
  if (!checkCronAuth(req)) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  try {
    await dbConnect();

    // Find users missing any of: subaccount, api key, phone number
    const cursor = User.find({
      $or: [
        { billingMode: { $in: [null, ""] } },
        { "twilio.accountSid": { $in: [null, ""] } },
        { "twilio.apiKeySid": { $in: [null, ""] } },
        { "twilio.apiKeySecret": { $in: [null, ""] } },
        { numbers: { $exists: false } },
        { numbers: { $size: 0 } },
      ],
    })
      .select({ email: 1, role: 1, cardOnFile: 1, twilio: 1, numbers: 1, numberProvisionedAt: 1 })
      .lean()
      .cursor();

    let processed = 0;
    for await (const u of cursor as any) {
      const email = String(u.email || "").toLowerCase();
      try {
        const identity = await ensureUserTwilioIdentity(email);
        const hasNumber = (Array.isArray(u.numbers) && u.numbers.length > 0) || Boolean(u.numberProvisionedAt);
        const adminBypass = u.role === "admin" || isAdmin(email);
        const shouldBuyNumber = !hasNumber && (u.cardOnFile === true || adminBypass);

        let r = identity;
        if (shouldBuyNumber) {
          r = await provisionUserTwilio(email);
        } else if (!hasNumber) {
          console.log(`[Cron] Skipping number purchase for ${u.email} — no card on file`);
        }

        processed++;
        console.log(`[ensure-twilio] ${email} -> ${r.ok ? "ok" : `fail: ${r.message}`}`);
      } catch (e: any) {
        console.warn(`[ensure-twilio] ${email} error:`, e?.message || e);
      }
    }

    return res.status(200).json({ ok: true, processed });
  } catch (err: any) {
    console.error("ensure-twilio-provision error:", err?.message || err);
    // Always 200 so schedulers don't retry-storm
    return res.status(200).json({ ok: false, message: err?.message || "error" });
  }
}
