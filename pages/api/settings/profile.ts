// /pages/api/settings/profile.ts
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ message: "Unauthorized" });

  await dbConnect();

  try {
    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const fullName = user.name || "";
    const [firstName = "", ...lastNameParts] = fullName.split(" ");
    const lastName = lastNameParts.join(" ");

    res.status(200).json({
      firstName,
      lastName,
      email: user.email || "",
      country: user.country || "United States",
      agentPhone: user.agentPhone || "", // ✅ include agent phone so the UI can prefill
      workingHours: user.bookingSettings?.workingHours || {
        Monday: { start: "08:00", end: "21:00" },
        Tuesday: { start: "08:00", end: "21:00" },
        Wednesday: { start: "08:00", end: "21:00" },
        Thursday: { start: "08:00", end: "21:00" },
        Friday: { start: "08:00", end: "21:00" },
      },
    });
  } catch (error) {
    console.error("Fetch profile error:", error);
    res
      .status(500)
      .json({ message: "Something went wrong while fetching profile" });
  }
}
