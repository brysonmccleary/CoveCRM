// pages/api/cron/verify-doi-emails.ts
// Kicks off SMTP verification for queued DOI agent emails.
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import { verifyQueuedEmails } from "@/scripts/verify-email-smtp";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  try {
    const summary = await verifyQueuedEmails();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/verify-doi-emails] Fatal error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Verification failed",
    });
  }
}
