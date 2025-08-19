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
  const userEmail = session.user.email;
  const { id } = req.query;

  try {
    const folder = await Folder.findOne({ _id: id, user: userEmail });

    if (!folder) {
      return res
        .status(404)
        .json({ message: "Folder not found or access denied" });
    }

    if (req.method === "PUT") {
      const { name, description } = req.body;
      folder.name = name ?? folder.name;
      folder.description = description ?? folder.description;

      await folder.save();
      return res.status(200).json(folder);
    }

    if (req.method === "DELETE") {
      await folder.deleteOne();
      return res.status(200).json({ message: "Folder deleted" });
    }

    res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Folder update/delete error:", error);
    res.status(500).json({ message: "Server error" });
  }
}
