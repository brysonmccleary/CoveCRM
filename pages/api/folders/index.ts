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
  const session = await getServerSession(req, res, authOptions as any);
  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";

  if (!email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const userEmail = email;

  if (req.method === "GET") {
    try {
      // STRICT: only folders for this user by userEmail.
      // No more legacy `user` field usage.
      const folders = await Folder.find({
        userEmail,
      }).sort({ createdAt: 1, _id: 1 });

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

      // Create folder tied ONLY to this user (canonical userEmail).
      const newFolder = new Folder({
        name: trimmedName,
        userEmail,
      });

      // allow optional description via loose schema
      if (typeof description === "string") {
        (newFolder as any).description = description;
      }

      await newFolder.save();
      return res.status(201).json(newFolder);
    } catch (error) {
      console.error("Create folder error:", error);
      return res.status(400).json({ message: "Error creating folder" });
    }
  }

  return res.status(405).json({ message: "Method not allowed" });
}
