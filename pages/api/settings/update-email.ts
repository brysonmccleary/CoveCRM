import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ message: "Unauthorized" });

  await dbConnect();

  try {
    const { newEmail } = req.body;

    if (!newEmail || typeof newEmail !== "string") {
      return res.status(400).json({ message: "Invalid email" });
    }

    const existingUser = await User.findOne({ email: newEmail });
    if (existingUser && existingUser.email !== session.user.email) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.email = newEmail;
    await user.save();

    return res.status(200).json({ message: "Email updated" });
  } catch (err) {
    console.error("Update email error:", err);
    return res
      .status(500)
      .json({ message: "Server error while updating email" });
  }
}
