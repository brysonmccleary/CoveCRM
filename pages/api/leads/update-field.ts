// pages/api/leads/update-field.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

/**
 * POST /api/leads/update-field
 * Body: { leadId: string, field: string, value: any }
 *
 * - Updates exactly ONE field on ONE lead.
 * - Enforces ownership by session userEmail.
 * - Blocks unsafe/internal fields.
 * - Supports field names with spaces (e.g. "First Name").
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const userEmail = session.user.email;

  const { leadId, field, value } = req.body || {};

  if (!leadId || typeof leadId !== "string") {
    return res.status(400).json({ success: false, message: "Missing leadId" });
  }

  if (!field || typeof field !== "string") {
    return res.status(400).json({ success: false, message: "Missing field" });
  }

  // --- hard block prototype pollution / unsafe paths ---
  const trimmedField = field.trim();

  // Disallow nested paths entirely (prevents editing "a.b" or "$where" type tricks)
  if (trimmedField.includes(".") || trimmedField.startsWith("$")) {
    return res.status(400).json({ success: false, message: "Invalid field name" });
  }

  // Prevent prototype pollution
  const lower = trimmedField.toLowerCase();
  if (lower === "__proto__" || lower === "prototype" || lower === "constructor") {
    return res.status(400).json({ success: false, message: "Invalid field name" });
  }

  // Block system/internal keys you should never allow editing from UI
  const BLOCKED_FIELDS = new Set<string>([
    "_id",
    "id",
    "userEmail",
    "ownerId",
    "createdAt",
    "updatedAt",
    "folderId", // keep folder moves controlled by existing UI/endpoints
    "assignedDrips",
    "dripProgress",
  ]);

  if (BLOCKED_FIELDS.has(trimmedField)) {
    return res.status(400).json({ success: false, message: "This field cannot be edited" });
  }

  // --- normalize value ---
  // Your UI sends strings most of the time. Keep as-is unless it looks like JSON.
  let normalized: any = value;

  if (typeof normalized === "string") {
    // if user typed JSON object/array, accept it as structured data
    const s = normalized.trim();
    if (
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"))
    ) {
      try {
        normalized = JSON.parse(s);
      } catch {
        // leave as string if JSON parse fails
        normalized = value;
      }
    }
  }

  // Special case: if they try to edit a field that should be an ObjectId, we can safely cast it
  // (We still block folderId above, but leaving this here for future-safe expansion.)
  if (trimmedField.toLowerCase().endsWith("id") && typeof normalized === "string") {
    const maybe = normalized.trim();
    if (Types.ObjectId.isValid(maybe)) {
      normalized = new Types.ObjectId(maybe);
    }
  }

  try {
    await dbConnect();

    const update: any = { $set: { [trimmedField]: normalized } };

    const result = await Lead.updateOne(
      { _id: leadId, userEmail },
      update
    );

    if ((result as any).matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Lead not found or access denied" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error updating lead field:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
