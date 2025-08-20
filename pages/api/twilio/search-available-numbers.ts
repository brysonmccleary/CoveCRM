import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const email = session.user.email.toLowerCase();
  const { areaCode, contains, sms = "true", voice = "true", limit = "10" } = req.query as any;

  try {
    const { client } = await getClientForUser(email);
    const searchOpts: any = {
      countryCode: "US",
      smsEnabled: String(sms) !== "false",
      voiceEnabled: String(voice) !== "false",
      limit: Math.min(parseInt(limit || "10", 10), 30),
    };
    if (areaCode) searchOpts.areaCode = areaCode;
    if (contains) searchOpts.contains = contains;

    const nums = await client.availablePhoneNumbers("US").local.list(searchOpts);
    res.status(200).json({
      ok: true,
      results: nums.map(n => ({
        friendlyName: n.friendlyName,
        phoneNumber: n.phoneNumber,
        locality: n.locality,
        region: n.region,
        postalCode: n.postalCode,
        lata: n.lata,
        rateCenter: n.rateCenter,
        capabilities: n.capabilities,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "search failed" });
  }
}
