// Usage:
//  DRY RUN (no writes):  npx ts-node --esm --transpile-only scripts/migrations/normalize-folderIds.ts
//  APPLY CHANGES:        APPLY=1 npx ts-node --esm --transpile-only scripts/migrations/normalize-folderIds.ts

import "dotenv/config";
import mongoose, { Types } from "mongoose";

// ⬇️ Explicit .ts extensions so the ESM loader can resolve them.
import dbConnect from "../../lib/mongooseConnect";
import Lead from "../../models/Lead";
import Folder from "../../models/Folder";

type AnyLead = Record<string, any>;

function toLC(x: any) {
  return typeof x === "string" ? x.trim().toLowerCase() : undefined;
}

function pickFolderName(l: AnyLead) {
  const raw =
    l?.folderName ??
    l?.Folder ??
    (typeof l === "object" ? l["Folder Name"] : undefined) ??
    (typeof l === "object" ? l["folder"] : undefined);
  const s = typeof raw === "string" ? raw.trim() : undefined;
  return s && s.length ? s : undefined;
}

async function ensureFolder(userEmail: string, name: string) {
  let f = await Folder.findOne({ userEmail, name })
    .select({ _id: 1 })
    .lean<{ _id: Types.ObjectId } | null>();
  if (!f) {
    const created = await Folder.create({ userEmail, name, assignedDrips: [] });
    return created._id as Types.ObjectId;
  }
  return f._id;
}

async function run() {
  const APPLY = !!process.env.APPLY;

  await dbConnect();

  let scanned = 0;
  let setByName = 0;
  let convertedIds = 0;
  let lcEmails = 0;
  let skippedNoEmail = 0;
  let skippedNoFolderInfo = 0;

  const batchOps: any[] = [];
  const BULK_SIZE = 1000;

  const cursor = Lead.find(
    {},
    { _id: 1, userEmail: 1, ownerEmail: 1, folderId: 1, folderName: 1, Folder: 1 }
  )
    .lean<AnyLead>()
    .cursor();

  for await (const l of cursor) {
    scanned++;

    const id = String(l._id);
    const userEmail =
      toLC(l.userEmail) || toLC(l.ownerEmail) || toLC((l as any).user);
    if (!userEmail) {
      skippedNoEmail++;
      continue;
    }

    const update: AnyLead = {};
    let needUpdate = false;

    // Lowercase userEmail for consistency
    if (l.userEmail !== userEmail) {
      update.userEmail = userEmail;
      lcEmails++;
      needUpdate = true;
    }

    // Normalize folderId
    const hasFolderId = l.folderId !== undefined && l.folderId !== null;

    if (hasFolderId) {
      // If stored as string and looks like ObjectId → convert to ObjectId
      if (typeof l.folderId === "string" && Types.ObjectId.isValid(l.folderId)) {
        update.folderId = new Types.ObjectId(l.folderId);
        convertedIds++;
        needUpdate = true;
      }
    } else {
      // Backfill from legacy folder name fields
      const legacyName = pickFolderName(l);
      if (!legacyName) {
        skippedNoFolderInfo++;
      } else {
        const fid = await ensureFolder(userEmail, legacyName);
        update.folderId = fid;
        setByName++;
        needUpdate = true;
      }
    }

    if (needUpdate) {
      batchOps.push({
        updateOne: {
          filter: { _id: id },
          update: { $set: update },
        },
      });
    }

    if (batchOps.length >= BULK_SIZE) {
      if (APPLY && batchOps.length) {
        await Lead.bulkWrite(batchOps, { ordered: false });
      }
      batchOps.length = 0;
    }
  }

  if (APPLY && batchOps.length) {
    await Lead.bulkWrite(batchOps, { ordered: false });
  }

  console.log("=== Normalize folderIds DONE ===");
  console.table({
    scanned,
    lcEmails,
    convertedIds,
    setByName,
    skippedNoEmail,
    skippedNoFolderInfo,
    applied: APPLY,
  });

  // Ensure system folders exist for all users we touched
  const SYSTEM_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"];
  const distinctUsers = await Lead.distinct("userEmail");
  for (const u of distinctUsers.filter(Boolean)) {
    for (const name of SYSTEM_FOLDERS) {
      const exists = await Folder.findOne({ userEmail: u, name }).lean();
      if (!exists) await Folder.create({ userEmail: u, name, assignedDrips: [] });
    }
  }

  await mongoose.connection.close();
}

run().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
