import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { Types } from "mongoose";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import ApiKey from "@/models/ApiKey";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const userEmail = String(session?.user?.email || "").trim().toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });
  if (req.method !== "DELETE") return res.status(405).json({ message: "Method not allowed" });

  const id = String(req.query.id || "");
  if (!Types.ObjectId.isValid(id)) return res.status(404).json({ message: "API key not found" });
  await dbConnect();
  const revoked = await ApiKey.findOneAndUpdate(
    { _id: id, userEmail },
    { $set: { revokedAt: new Date() } },
    { new: true },
  );
  if (!revoked) return res.status(404).json({ message: "API key not found" });
  return res.status(200).json({ ok: true });
}
