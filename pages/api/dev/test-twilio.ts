// pages/api/dev/test-twilio.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

function maskSid(sid?: string | null) {
  if (!sid) return null;
  if (sid.length <= 8) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const accountSid =
    process.env.TWILIO_ACCOUNT_SID ||
    process.env.TWILIO_MASTER_ACCOUNT_SID ||
    "";
  const authToken =
    process.env.TWILIO_AUTH_TOKEN ||
    process.env.TWILIO_MASTER_AUTH_TOKEN ||
    "";

  if (!accountSid || !authToken) {
    return res.status(400).json({
      ok: false,
      error:
        "Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN in env (or MASTER variants).",
      accountSidPresent: !!accountSid,
      authTokenPresent: !!authToken,
    });
  }

  try {
    const client = twilio(accountSid, authToken);
    const account = await client.api.accounts(accountSid).fetch();

    return res.status(200).json({
      ok: true,
      accountSid: maskSid(accountSid),
      friendlyName: account.friendlyName,
      status: account.status,
      type: account.type,
    });
  } catch (err: any) {
    console.error("Twilio self-test error:", err?.message || err);

    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      code: (err as any)?.code || null,
      status: (err as any)?.status || null,
      moreInfo: (err as any)?.moreInfo || null,
    });
  }
}
