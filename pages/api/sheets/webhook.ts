// /pages/api/sheets/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { isSystemFolderName as isSystemFolder, isSystemish } from "@/lib/systemFolders";

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req: NextApiRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function timingSafeEqualHex(a: string, b: string) {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function hmacHex(body: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function getOrCreateSafeFolder(userEmail: string, folderName: string) {
  let name = String(folderName || "").trim() || "Imported Leads";
  if (isSystemFolder(name) || isSystemish(name)) name = `${name} (Leads)`;

  let folder = await Folder.findOne({ userEmail, name });
  if (!folder) folder = await Folder.create({ userEmail, name, source: "google-sheets" });

  if (!folder?.name || isSystemFolder(folder.name) || isSystemish(folder.name)) {
    const safe = `${name} — ${Date.now()}`;
    folder = await Folder.create({ userEmail, name: safe, source: "google-sheets" });
  }

  return folder;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const sig = String(req.headers["x-covecrm-signature"] || "").trim();
    if (!sig) return res.status(401).json({ error: "Missing signature" });

    const rawBody = await readRawBody(req);
    if (!rawBody) return res.status(400).json({ error: "Missing body" });

    const payload = JSON.parse(rawBody || "{}") as {
      userEmail?: string;
      sheetId?: string;
      gid?: string;
      tabName?: string;
      row?: Record<string, any>;
      ts?: number;
    };

    const userEmail = String(payload.userEmail || "").trim().toLowerCase();
    const sheetId = String(payload.sheetId || "").trim();
    if (!userEmail || !sheetId) return res.status(400).json({ error: "Missing userEmail or sheetId" });

    await dbConnect();

    const user = await User.findOne({ email: userEmail });
    if (!user) return res.status(404).json({ error: "User not found" });

    const gs: any = (user as any).googleSheets || {};
    const secret = String(gs.webhookSecret || "");
    if (!secret) return res.status(403).json({ error: "Webhook not enabled for user" });

    const expected = hmacHex(rawBody, secret);
    if (!timingSafeEqualHex(sig, expected)) {
      return res.status(403).json({ error: "Invalid signature" });
    }

    const synced = Array.isArray(gs.syncedSheets) ? gs.syncedSheets : [];
    const match = synced.find((s: any) => String(s.sheetId || "") === sheetId);
    if (!match) return res.status(404).json({ error: "No sheet mapping found for this user" });

    const folderName = String(match.folderName || "").trim() || "Imported Leads";
    const folder = await getOrCreateSafeFolder(userEmail, folderName);

    const row = payload.row || {};
    const firstName = row.firstName || row["First Name"] || row.firstname || "";
    const lastName = row.lastName || row["Last Name"] || row.lastname || "";
    const phone = row.phone || row["Phone"] || row["phoneNumber"] || row["Phone Number"] || "";
    const email = row.email || row["Email"] || "";

    await Lead.create({
      userEmail,
      folderId: folder._id,
      firstName: String(firstName || "").trim(),
      lastName: String(lastName || "").trim(),
      phone: String(phone || "").trim(),
      email: String(email || "").trim(),
      source: "google-sheets",
      rawData: row,
    });

    match.lastSyncedAt = new Date();
    match.lastEventAt = new Date();
    (user as any).googleSheets = gs;
    await user.save();

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Webhook failed" });
  }
}
