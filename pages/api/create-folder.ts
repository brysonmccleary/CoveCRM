// /pages/api/create-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { name } = req.body as { name?: string };

    if (!name || name.trim() === "") {
      return res.status(400).json({ message: "Folder name is required" });
    }

    await dbConnect();
    const newFolder = await Folder.create({
      name: name.trim(),
      userEmail: session.user.email,
      createdAt: new Date(),
    });

    res.status(201).json({
      message: "Folder created successfully",
      folderId: newFolder._id,
    });
  } catch (error) {
    console.error("Error creating folder:", error);
    res.status(500).json({ message: "Failed to create folder" });
  }
}
