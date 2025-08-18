import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ message: "User not found" });

  const a2p = await A2PProfile.findOne({ userId: user._id }).lean();
  const phones = await PhoneNumber.find({ userId: user._id })
    .lean()
    .catch(() => []);
  return res.status(200).json({
    user: { id: String(user._id), email: user.email },
    a2p: a2p
      ? {
          profileSid: a2p.profileSid || null,
          messagingServiceSid: a2p.messagingServiceSid || null,
          campaignSid: (a2p as any).campaignSid || null,
        }
      : null,
    phoneNumbers: (phones || []).map((p: any) => ({
      phoneNumber: p.phoneNumber,
      messagingServiceSid: p.messagingServiceSid || null,
      twilioSid: p.twilioSid || null,
    })),
  });
}
