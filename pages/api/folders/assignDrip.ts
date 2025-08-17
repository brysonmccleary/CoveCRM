import dbConnect from "../../../dbConnect";
import Folder from "../../../models/Folder";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();

  if (req.method === "POST") {
    const { folderId, dripId } = req.body;

    if (!folderId || !dripId) {
      return res.status(400).json({ message: "Missing folderId or dripId" });
    }

    try {
      const folder = await Folder.findById(folderId);

      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }

      folder.assignedDrip = dripId;
      await folder.save();

      res.status(200).json({ message: "Drip assigned successfully", folder });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error assigning drip to folder" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}

