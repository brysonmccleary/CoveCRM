import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import twilioClient from "../../lib/twilioClient";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  const { sid } = req.body;

  if (!sid) {
    return res.status(400).json({ message: "Missing SID" });
  }

  try {
    await dbConnect();
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const numbers = Array.isArray(user.numbers) ? user.numbers : [];
    const entryIndex = numbers.findIndex((n: any) => n?.sid === sid);
    if (entryIndex === -1) {
      return res.status(403).json({ message: "Number not found on your account" });
    }

    await twilioClient.incomingPhoneNumbers(sid).remove();

    user.numbers = numbers.filter((n: any) => n?.sid !== sid);
    await user.save();

    res.status(200).json({ message: "Number deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting number" });
  }
}
