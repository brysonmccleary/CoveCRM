import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Drip from "@/models/Drip"; // Create this if it doesn’t exist
import { prebuiltDrips } from "@/utils/prebuiltDrips";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if ((session?.user as any)?.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    await dbConnect();

    // Clear old prebuilt drips
    await Drip.deleteMany({ type: "prebuilt" });

    // Insert with metadata
    const dripsToInsert = prebuiltDrips.map((drip) => ({
      ...drip,
      type: "prebuilt",
      createdAt: new Date(),
    }));

    await Drip.insertMany(dripsToInsert);

    res.status(200).json({ message: "Prebuilt drips reset successfully!" });
  } catch (error) {
    console.error("Error resetting drips:", error);
    res.status(500).json({ message: "Failed to reset drips." });
  }
}
