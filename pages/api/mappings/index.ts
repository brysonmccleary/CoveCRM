import dbConnect from "@/lib/dbConnect";
import Mapping from "@/models/Mapping";
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";

function lc(input?: string | null) {
  return String(input || "").trim().toLowerCase();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  const session = await getServerSession(req, res, authOptions);
  const userEmail = lc(session?.user?.email);

  if (!userEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.method === "GET") {
    const mappings = await Mapping.find({ userEmail }).sort({ createdAt: -1, name: 1 });
    return res.status(200).json(mappings);
  }

  if (req.method === "POST") {
    const { name, fields } = req.body || {};

    const cleanName = String(name || "").trim();
    if (!cleanName) {
      return res.status(400).json({ message: "Template name is required" });
    }
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return res.status(400).json({ message: "fields object is required" });
    }

    const mapping = await Mapping.findOneAndUpdate(
      { userEmail, name: cleanName },
      {
        $set: {
          userEmail,
          name: cleanName,
          fields,
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    return res.status(201).json(mapping);
  }

  return res.status(405).json({ message: "Method not allowed" });
}
