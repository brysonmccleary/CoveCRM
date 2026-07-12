import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import crypto from "crypto";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import ApiKey from "@/models/ApiKey";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function generateKey(): string {
  const bytes = crypto.randomBytes(32);
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let encoded = "";
  while (value > 0n) {
    encoded = BASE62[Number(value % 62n)] + encoded;
    value /= 62n;
  }
  return `cove_live_${encoded.padStart(43, "0")}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const userEmail = String(session?.user?.email || "").trim().toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });
  await dbConnect();

  if (req.method === "GET") {
    const keys = await ApiKey.find({ userEmail })
      .select("name folderName keyPrefix lastUsedAt createdAt revokedAt")
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ keys });
  }

  if (req.method === "POST") {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const folderName = typeof req.body?.folderName === "string" ? req.body.folderName.trim() : "";
    if (!name) return res.status(422).json({ message: "Key name is required" });
    if (!folderName) return res.status(422).json({ message: "Folder name is required" });
    if (name.length > 80) return res.status(422).json({ message: "Key name must be 80 characters or fewer" });
    if (folderName.length > 120) return res.status(422).json({ message: "Folder name must be 120 characters or fewer" });

    const key = generateKey();
    const keyHash = crypto.createHash("sha256").update(key).digest("hex");
    const keyPrefix = key.slice(0, "cove_live_".length + 4);
    const created = await ApiKey.create({ userEmail, name, folderName, keyPrefix, keyHash });
    return res.status(201).json({
      id: String(created._id),
      name: created.name,
      folderName: created.folderName,
      key,
      keyPrefix: created.keyPrefix,
      createdAt: created.createdAt,
    });
  }

  return res.status(405).json({ message: "Method not allowed" });
}
