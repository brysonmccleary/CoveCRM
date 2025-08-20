import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { client } = await getClientForUser(session.user.email.toLowerCase());
    const nums = await client.incomingPhoneNumbers.list({ limit: 100 });
    res.status(200).json({
      ok: true,
      count: nums.length,
      numbers: nums.map(n => ({
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        smsUrl: n.smsUrl,
        voiceUrl: n.voiceUrl,
        capabilities: n.capabilities,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "list failed" });
  }
}
