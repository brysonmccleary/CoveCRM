import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import mongoose from "mongoose";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import MetaLaunchArchive from "@/models/MetaLaunchArchive";

function decodeArchivedImage(dataUrl: string) {
  const match = String(dataUrl || "")
    .trim()
    .match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  return buffer.length ? { mimeType, buffer } : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const id = String(req.query.id || "").trim();
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: "Creative preview not found" });

  await mongooseConnect();
  const archive = await MetaLaunchArchive.findOne({
    campaignId: id,
    userEmail: session.user.email.toLowerCase(),
  }, { images: { $slice: 1 } })
    .select("images")
    .lean() as any;
  const firstImage = Array.isArray(archive?.images) ? archive.images[0] : null;
  const decoded = decodeArchivedImage(String(firstImage?.dataUrl || ""));
  if (!decoded) return res.status(404).json({ error: "Creative preview not found" });

  res.setHeader("Content-Type", decoded.mimeType);
  res.setHeader("Content-Length", String(decoded.buffer.length));
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  return res.status(200).end(decoded.buffer);
}
