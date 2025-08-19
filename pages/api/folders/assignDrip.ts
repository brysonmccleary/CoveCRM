// /pages/api/folders/assignDrip.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { folderId, dripId } = req.body as {
    folderId?: string;
    dripId?: string;
  };

  if (!folderId || !dripId) {
    return res.status(400).json({ message: "Missing folderId or dripId" });
  }

  try {
    const folder: any = await Folder.findById(folderId);
    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    // Ensure array field exists, align with other code paths that use `assignedDrips`
    folder.assignedDrips = Array.isArray(folder.assignedDrips)
      ? folder.assignedDrips
      : [];

    if (!folder.assignedDrips.includes(dripId)) {
      folder.assignedDrips.push(dripId);
    }

    await folder.save();

    return res
      .status(200)
      .json({ message: "Drip assigned successfully", folderId: folder._id });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ message: "Error assigning drip to folder" });
  }
}
