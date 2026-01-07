// pages/api/update-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

function normalizeFieldName(f: any) {
  return String(f || "").trim();
}

function isBlockedField(field: string) {
  const lower = field.trim().toLowerCase();

  // hard block nested paths & mongo operators
  if (!field || field.includes(".") || field.startsWith("$")) return true;

  // prevent prototype pollution
  if (lower === "__proto__" || lower === "prototype" || lower === "constructor") return true;

  // block system/internal fields
  const BLOCKED = new Set<string>([
    "_id",
    "id",
    "useremail",
    "ownerid",
    "userid",
    "createdat",
    "updatedat",
    "__v",
    "folderid", // keep folder moves controlled by existing behavior below
    "assigneddrips",
    "dripprogress",
    "history",
    "interactionhistory",
  ]);

  if (BLOCKED.has(lower)) return true;
  return false;
}

function coerceValue(val: any) {
  let v: any = val;

  if (typeof v === "string") {
    const s = v.trim();

    // allow typed JSON (object/array)
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try {
        v = JSON.parse(s);
      } catch {
        v = val;
      }
    }
  }

  // Cast "*Id" values to ObjectId when valid
  if (typeof v === "string") {
    const maybe = v.trim();
    // only cast if it looks like an ObjectId
    if (Types.ObjectId.isValid(maybe)) {
      // NOTE: folderId handled separately below
      v = new Types.ObjectId(maybe);
    }
  }

  return v;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userEmail = session.user.email;
  const body = req.body || {};

  const leadId = body.leadId;
  if (!leadId || typeof leadId !== "string") {
    return res.status(400).json({ message: "Missing leadId" });
  }

  const { status, notes, folderId } = body;

  try {
    await dbConnect();

    const updateFields: any = {};

    // ✅ Preserve existing behavior
    if (status) updateFields.status = status;
    if (notes) updateFields["Notes"] = notes; // match your schema field casing
    if (folderId) updateFields.folderId = new Types.ObjectId(folderId);

    // ✅ New: support live editing
    // Accept either:
    // 1) { field, value }
    // 2) { updates: { [field]: value } }
    if (body.field && typeof body.field === "string") {
      const f = normalizeFieldName(body.field);
      if (isBlockedField(f)) {
        return res.status(400).json({ message: "This field cannot be edited" });
      }
      updateFields[f] = coerceValue(body.value);
    }

    if (body.updates && typeof body.updates === "object") {
      const entries = Object.entries(body.updates as Record<string, any>);
      for (const [rawField, rawValue] of entries) {
        const f = normalizeFieldName(rawField);
        if (!f) continue;
        if (isBlockedField(f)) continue;
        updateFields[f] = coerceValue(rawValue);
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const result = await Lead.updateOne({ _id: leadId, userEmail }, { $set: updateFields });

    if ((result as any).matchedCount === 0) {
      return res.status(404).json({ message: "Lead not found or access denied" });
    }

    res.status(200).json({ message: "Lead updated successfully" });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
