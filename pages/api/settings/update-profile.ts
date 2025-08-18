// /pages/api/settings/update-profile.ts
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

function normalizeUSPhone(raw?: string) {
  if (!raw) return "";
  const d = raw.replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  // leave non-US as-is (user can enter +44..., etc.)
  return raw.trim();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  await dbConnect();

  try {
    const {
      firstName,
      lastName,
      email,
      country,
      workingHours,
      agentPhone, // NEW
    } = req.body || {};

    // Basic type validation
    if (
      !firstName ||
      typeof firstName !== "string" ||
      !lastName ||
      typeof lastName !== "string" ||
      !email ||
      typeof email !== "string" ||
      !country ||
      typeof country !== "string"
    ) {
      return res.status(400).json({ message: "Invalid input data" });
    }

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Update core profile fields
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
    user.name = fullName;
    user.email = email;
    user.country = country;

    // NEW: persist agentPhone (normalized)
    if (typeof agentPhone === "string") {
      user.agentPhone = normalizeUSPhone(agentPhone);
    }

    // Optional: update working hours
    if (workingHours && typeof workingHours === "object") {
      if (!user.bookingSettings) user.bookingSettings = {} as any;
      user.bookingSettings.workingHours = workingHours;
    }

    await user.save();

    // Respond with a minimal payload; client can refetch session/profile as needed
    return res.status(200).json({
      message: "Profile updated",
      agentPhone: user.agentPhone || "",
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return res
      .status(500)
      .json({ message: "Something went wrong while updating profile" });
  }
}
