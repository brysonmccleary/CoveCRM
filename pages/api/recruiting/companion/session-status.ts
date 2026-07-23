import type { NextApiRequest, NextApiResponse } from "next";
import { sendEmail } from "@/lib/email";
import { authenticateCompanion } from "@/lib/recruiting/companion/auth";
import RecruitingPlatformSession from "@/models/RecruitingPlatformSession";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companion = await authenticateCompanion(req);
  if (!companion) return res.status(401).json({ error: "Invalid companion token." });
  if (req.method === "GET") {
    const sessions = await RecruitingPlatformSession.find({ companionId: companion._id })
      .select("platform status lastDetectedAt")
      .lean();
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ sessions });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const platform = req.body?.platform === "linkedin" ? "linkedin" : req.body?.platform === "instagram" ? "instagram" : null;
  const status = req.body?.status === "logged_out" ? "logged_out" : req.body?.status === "active" ? "active" : null;
  if (!platform || !status || !companion.allowedPlatforms.includes(platform)) {
    return res.status(400).json({ error: "Valid platform and session status are required." });
  }

  const now = new Date();
  const previous = await RecruitingPlatformSession.findOne({ companionId: companion._id, platform });
  const shouldAlert = status === "logged_out" && (
    previous?.status !== "logged_out" || !previous?.lastAlertSentAt || now.getTime() - previous.lastAlertSentAt.getTime() >= 24 * 60 * 60 * 1000
  );
  const session = await RecruitingPlatformSession.findOneAndUpdate(
    { companionId: companion._id, platform },
    {
      $setOnInsert: { ownerEmail: companion.ownerEmail, companionId: companion._id, platform },
      $set: { status, lastDetectedAt: now },
    },
    { upsert: true, new: true },
  );
  if (shouldAlert) {
    const platformName = platform === "linkedin" ? "LinkedIn" : "Instagram";
    const result = await sendEmail(
      companion.ownerEmail,
      `${platformName} needs to be logged back in`,
      `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a"><h2>Your ${platformName} session ended</h2><p>CoveCRM paused ${platformName} recruiting actions because the browser is no longer signed in.</p><p>Open ${platformName} in your connected recruiting browser, log back in normally, and CoveCRM will resume automatically.</p><p><a href="https://www.covecrm.com/recruiting">Open AI Recruiting</a></p></div>`,
    );
    if (result.ok) {
      session.lastAlertSentAt = now;
      await session.save();
    }
  }
  return res.status(200).json({ ok: true, status, emailAttempted: shouldAlert });
}
