// pages/api/folders/[id].ts
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
  const { id } = req.query;

  try {
    // Folder must belong to THIS user only (strict userEmail).
    const folder = await Folder.findOne({
      _id: id,
      userEmail,
    });

    if (!folder) {
      return res
        .status(404)
        .json({ message: "Folder not found or access denied" });
    }

    if (req.method === "PUT") {
      const { name, description } = req.body as {
        name?: string;
        description?: string;
      };

      if (typeof name === "string" && name.trim()) {
        folder.name = name.trim();
      }

      // `description` is not in the TS interface, but schema is strict:false,
      // so we safely assign it via `any` to keep TypeScript happy.
      if (typeof description === "string") {
        (folder as any).description = description;
      }

      await folder.save();
      return res.status(200).json(folder);
    }

    if (req.method === "DELETE") {
      await folder.deleteOne();
      return res.status(200).json({ message: "Folder deleted" });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Folder update/delete error:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
