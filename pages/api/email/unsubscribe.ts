// pages/api/email/unsubscribe.ts
// No auth required — linked from email footers.
// Accepts ?mid=<emailMessageId> to identify the sender + recipient from the EmailMessage record.
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import EmailMessage from "@/models/EmailMessage";
import EmailSuppression from "@/models/EmailSuppression";

const UNSUBSCRIBE_HTML = `
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Unsubscribed</title></head>
  <body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f172a;color:#e2e8f0;">
    <h2 style="color:#fff;">You have been unsubscribed.</h2>
    <p>You will no longer receive emails from this sender.</p>
  </body>
</html>
`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const mid =
    req.method === "GET"
      ? (req.query.mid as string)
      : (req.body?.mid as string);

  if (!mid) {
    return res.status(400).json({ error: "mid is required" });
  }

  await mongooseConnect();

  const message = await EmailMessage.findById(mid)
    .select("userId userEmail to")
    .lean();

  if (!message) {
    // Return success page regardless — do not leak whether mid exists
    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html");
      return res.status(200).send(UNSUBSCRIBE_HTML);
    }
    return res.status(200).json({ ok: true });
  }

  const { userId, userEmail, to } = message as any;

  await EmailSuppression.updateOne(
    { userEmail, email: (to as string).toLowerCase() },
    {
      $setOnInsert: {
        userId,
        userEmail,
        email: (to as string).toLowerCase(),
        reason: "unsubscribed",
        suppressedAt: new Date(),
      },
    },
    { upsert: true }
  );

  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(UNSUBSCRIBE_HTML);
  }

  return res.status(200).json({ ok: true });
}
