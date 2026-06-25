import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { provisionUserTwilio } from "@/lib/twilio/provision";
import { isAdmin } from "@/lib/featureFlags";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email = String(session?.user?.email || "").toLowerCase();
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();

  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const adminBypass = (user as any).role === "admin" || isAdmin(email);
  if (adminBypass) {
    return res.status(200).json({ alreadyProvisioned: true });
  }

  if ((user as any).cardOnFile !== true) {
    return res.status(403).json({ error: "Please add a payment method before provisioning a number" });
  }

  if ((user as any).numberProvisionedAt || (Array.isArray((user as any).numbers) && (user as any).numbers.length > 0)) {
    return res.status(200).json({ alreadyProvisioned: true });
  }

  const result = await provisionUserTwilio(email);
  if ((result as any).provisioned === false || result.ok !== true) {
    return res.status(500).json({ provisioned: false, reason: (result as any).reason || result.message });
  }

  const freshUser = await User.findOne({ email }).lean<any>();
  return res.status(200).json({
    provisioned: true,
    number: freshUser?.numbers?.[0]?.phoneNumber || result.data.phoneNumber,
  });
}
