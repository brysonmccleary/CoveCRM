// pages/api/import-leads.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import mongoose from "mongoose";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

const FINGERPRINT = "selfheal-v5h+plain-import";

const lc = (s?: string | null) => (s ? String(s).trim().toLowerCase() : "");
const digits = (s?: string | null) => (s ? String(s).replace(/\D+/g, "") : "");
const last10 = (s?: string | null) => {
  const d = digits(s);
  return d ? d.slice(-10) : "";
};

async function ensureNonSystemFolder(
  userEmail: string,
  name: string
) {
  if (!name) throw new Error("Folder name required");
  if (isSystemFolder(name)) throw new Error("Cannot import into system folders");

  const f = await Folder.findOneAndUpdate(
    { userEmail, name },
    { $setOnInsert: { userEmail, name, source: "manual-import" } },
    { new: true, upsert: true }
  );
  if (!f) throw new Error("Failed to resolve folder");
  if (isSystemFolder(f.name)) throw new Error("Resolved a system folder unexpectedly");
  return f;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const userEmail = lc(session.user.email)!;

  try {
    await dbConnect();

    // Body: { rows: Array<Record<string, any>>, targetFolderId?: string, folderName?: string }
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (c) => chunks.push(Buffer.from(c)));
      req.on("end", () => resolve());
      req.on("error", (e) => reject(e));
    });
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    const rows: Array<Record<string, any>> = Array.isArray(body.rows) ? body.rows : [];
    const targetFolderId: string | undefined = typeof body.targetFolderId === "string" ? body.targetFolderId : undefined;
    const folderName: string | undefined = typeof body.folderName === "string" ? body.folderName : undefined;

    if (!rows.length) return res.status(400).json({ message: "rows[] required" });

    let folderDoc: any = null;
    if (targetFolderId) {
      folderDoc = await Folder.findOne({ _id: targetFolderId, userEmail });
      if (!folderDoc) return res.status(400).json({ message: "Folder not found or not owned" });
      if (isSystemFolder(folderDoc.name)) return res.status(400).json({ message: "Cannot import into system folders" });
    } else if (folderName) {
      folderDoc = await ensureNonSystemFolder(userEmail, folderName);
    } else {
      return res.status(400).json({ message: "Provide targetFolderId or folderName" });
    }

    const targetFolderIdObj = folderDoc._id as mongoose.Types.ObjectId;
    const targetFolderName = String(folderDoc.name);

    const ops: any[] = [];
    let inserted = 0;
    let updated = 0;
    let skippedNoKey = 0;

    for (const raw of rows) {
      const email = lc(raw.email ?? raw.Email);
      const phone10 = last10(raw.phone ?? raw.Phone);

      if (!email && !phone10) { skippedNoKey++; continue; }

      const filter: any = { userEmail };
      const or: any[] = [];
      if (email) or.push({ email }, { Email: email });
      if (phone10) or.push({ normalizedPhone: phone10 }, { phoneLast10: phone10 });
      if (or.length) filter.$or = or;

      const set: Record<string, any> = {
        ownerEmail: userEmail,
        folderId: targetFolderIdObj,
        folder_name: targetFolderName,
        ["Folder Name"]: targetFolderName,
        updatedAt: new Date(),
      };

      const copyIf = (kIn: string, kOut: string = kIn) => {
        if (raw[kIn] !== undefined && raw[kIn] !== null && String(raw[kIn]).trim() !== "") {
          set[kOut] = raw[kIn];
        }
      };

      // basic fields (NEVER copy status/disposition)
      copyIf("First Name");
      copyIf("Last Name");
      copyIf("firstName", "First Name");
      copyIf("lastName", "Last Name");
      copyIf("State");
      copyIf("state", "State");
      copyIf("Notes");
      copyIf("notes", "Notes");
      copyIf("leadType");

      // identities
      if (email) { set["email"] = email; set["Email"] = email; }
      if (phone10) {
        set["normalizedPhone"] = phone10;
        set["phoneLast10"] = phone10;
        set["Phone"] = raw.Phone ?? raw.phone ?? phone10;
      }

      ops.push({
        updateOne: {
          filter,
          update: {
            $set: set,
            $setOnInsert: {
              userEmail,
              status: "New",
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (ops.length) {
      const result = await (Lead as any).bulkWrite(ops, { ordered: false });
      const upserts = (result as any).upsertedCount || 0;
      const total = ops.length;
      inserted = upserts;
      updated = Math.max(0, total - upserts - skippedNoKey);
    }

    return res.status(200).json({
      ok: true,
      fingerprint: FINGERPRINT,
      folderId: String(targetFolderIdObj),
      folderName: targetFolderName,
      counts: { inserted, updated, skippedNoKey, attempted: rows.length },
    });
  } catch (err: any) {
    console.error("import-leads error:", err);
    return res.status(500).json({ ok: false, message: err?.message || "Import failed", fingerprint: FINGERPRINT });
  }
}
