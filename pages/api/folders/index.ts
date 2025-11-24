// pages/api/folders/index.ts
import dbConnect from "@/lib/dbConnect";
import Folder from "@/models/Folder";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    try {
      // Scope folders strictly to this user. Support legacy `user` field plus new `userEmail`.
      const folders = await Folder.find({
        $or: [{ userEmail }, { user: userEmail }],
      });

      return res.status(200).json(folders);
    } catch (error) {
      console.error("Get folders error:", error);
      return res.status(500).json({ message: "Error fetching folders" });
    }
  }

  if (req.method === "POST") {
    try {
      const { name, description } = req.body as {
        name?: string;
        description?: string;
      };

      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Folder name is required" });
      }

      const trimmedName = name.trim();

      // Create folder tied to this user only (both legacy `user` and canonical `userEmail`).
      const newFolder = new Folder({
        name: trimmedName,
        description,
        user: userEmail,
        userEmail,
      });

      await newFolder.save();
      return res.status(201).json(newFolder);
    } catch (error) {
      console.error("Create folder error:", error);
      return res.status(400).json({ message: "Error creating folder" });
    }
  }

  res.status(405).json({ message: "Method not allowed" });
}
