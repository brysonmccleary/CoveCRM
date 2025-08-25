import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { Types } from "mongoose";

const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";

function norm(s: string) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  if (!INTERNAL_API_TOKEN || req.headers.authorization !== `Bearer ${INTERNAL_API_TOKEN}`) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userEmail = String((req.body as any)?.userEmail || "").toLowerCase();
  if (!userEmail) return res.status(400).json({ message: "Missing userEmail" });

  await dbConnect();

  // Build folder name map for this user
  const folders = await Folder.find({ userEmail }).lean();
  const byName = new Map<string, any>();
  for (const f of folders) byName.set(norm(f.name), f);

  const cursor = Lead.find({
    userEmail,
    $or: [{ folderId: { $exists: false } }, { folderId: null }],
  })
    .select([
      "_id",
      "folderId",
      "folderName",
      "Folder",
      "Folder Name",
      "userEmail",
    ])
    .lean()
    .cursor();

  let updated = 0;
  for await (const doc of cursor as any) {
    const nameRaw = doc.folderName ?? doc.Folder ?? doc["Folder Name"];
    const key = norm(nameRaw);
    if (!key) continue;

    const target = byName.get(key);
    if (!target?._id) continue;

    await Lead.updateOne(
      { _id: doc._id, userEmail, $or: [{ folderId: { $exists: false } }, { folderId: null }] },
      { $set: { folderId: new Types.ObjectId(String(target._id)) } }
    );

    updated++;
  }

  return res.status(200).json({ success: true, updated });
}
