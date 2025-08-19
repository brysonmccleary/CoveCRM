// /pages/api/settings/update-email.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = (await getServerSession(
    req,
    res,
    authOptions as any,
  )) as Session | null;

  const currentEmail =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";
  if (!currentEmail) return res.status(401).json({ message: "Unauthorized" });

  await dbConnect();

  try {
    const { newEmail } = (req.body || {}) as { newEmail?: string };

    if (!newEmail || typeof newEmail !== "string") {
      return res.status(400).json({ message: "Invalid email" });
    }

    const normalizedNew = newEmail.trim();

    const existingUser = await User.findOne({ email: normalizedNew }).lean();
    if (existingUser && existingUser.email?.toLowerCase() !== currentEmail) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const user = await User.findOne({ email: currentEmail });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.email = normalizedNew;
    await user.save();

    return res.status(200).json({ message: "Email updated" });
  } catch (err) {
    console.error("Update email error:", err);
    return res
      .status(500)
      .json({ message: "Server error while updating email" });
  }
}
