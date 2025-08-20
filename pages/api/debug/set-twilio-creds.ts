// /pages/api/debug/set-twilio-creds.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const email = session.user.email.toLowerCase();

  const { accountSid, apiKeySid, apiKeySecret } = (req.body || {}) as any;
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    return res.status(400).json({ error: "Missing accountSid, apiKeySid or apiKeySecret" });
  }

  try {
    await dbConnect();
    await User.updateOne({ email }, {
      $set: {
        "twilio.accountSid": accountSid,
        "twilio.apiKeySid": apiKeySid,
        "twilio.apiKeySecret": apiKeySecret,
      }
    });
    res.status(200).json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "set-twilio-creds failed" });
  }
}
