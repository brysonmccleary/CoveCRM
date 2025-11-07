// /pages/api/twilio/connect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { provisionUserTwilio } from "@/lib/twilio/provision";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ ok: false, message: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ ok: false, message: "User not found" });

  // Fast path: already provisioned with phone + keys
  if (user?.twilio?.accountSid && user?.twilio?.apiKeySid && user?.twilio?.apiKeySecret && Array.isArray(user.numbers) && user.numbers.length > 0) {
    return res.status(200).json({
      ok: true,
      message: "Already provisioned",
      data: {
        subaccountSid: user.twilio.accountSid,
        apiKeySid: user.twilio.apiKeySid,
        phone: user.numbers[0]?.phoneNumber || null,
      },
    });
  }

  const result = await provisionUserTwilio(email);

  if (!result.ok) {
    // Always return 200 to let UI poll/retry gracefully
    return res.status(200).json({ ok: false, message: result.message, error: result.error });
  }

  return res.status(200).json({
    ok: true,
    message: result.message,
    data: result.data,
  });
}
