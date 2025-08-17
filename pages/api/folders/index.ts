import dbConnect from "@/lib/dbConnect";
import Folder from "@/models/Folder";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const userEmail = session.user.email;

  if (req.method === "GET") {
    try {
      const folders = await Folder.find({ user: userEmail });
      return res.status(200).json(folders);
    } catch (error) {
      console.error("Get folders error:", error);
      return res.status(500).json({ message: "Error fetching folders" });
    }
  }

  if (req.method === "POST") {
    try {
      const { name, description } = req.body;

      const newFolder = new Folder({
        name,
        description,
        user: userEmail,
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
