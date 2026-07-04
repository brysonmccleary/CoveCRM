// pages/api/folders/ai-settings.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import { Types } from "mongoose";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  await mongooseConnect();

  const body = req.body || {};
  const { folderId } = body;

  if (!folderId || !Types.ObjectId.isValid(folderId)) {
    return res.status(400).json({ message: "Invalid folderId" });
  }

  const VALID_SCRIPT_KEYS = [
    "default",
    "final_expense",
    "mortgage_protection",
    "iul_cash_value",
    "veteran_leads",
    "veteran_iul",
    "veteran_mortgage",
    "trucker_leads",
    "trucker_iul",
    "trucker_mortgage",
    "generic_life",
  ];

  const existingFolder = await Folder.findOne({ _id: new Types.ObjectId(folderId), userEmail: email });
  if (!existingFolder) return res.status(404).json({ message: "Folder not found" });

  const update: any = {};

  if (Object.prototype.hasOwnProperty.call(body, "aiFirstCallEnabled")) {
    if (typeof body.aiFirstCallEnabled !== "boolean") {
      return res.status(400).json({ message: "aiFirstCallEnabled must be a boolean" });
    }

    const wasEnabled = !!(existingFolder as any).aiFirstCallEnabled;
    const nextEnabled = body.aiFirstCallEnabled;
    update.aiFirstCallEnabled = nextEnabled;

    if (!wasEnabled && nextEnabled) {
      update.aiEnabledAt = new Date();
    } else if (wasEnabled && !nextEnabled) {
      update.aiEnabledAt = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "aiFirstCallDelayMinutes")) {
    if (typeof body.aiFirstCallDelayMinutes !== "number" || !Number.isFinite(body.aiFirstCallDelayMinutes)) {
      return res.status(400).json({ message: "aiFirstCallDelayMinutes must be a number" });
    }
    if (body.aiFirstCallDelayMinutes < 0 || body.aiFirstCallDelayMinutes > 60) {
      return res.status(400).json({ message: "aiFirstCallDelayMinutes must be between 0 and 60" });
    }
    update.aiFirstCallDelayMinutes = Math.round(body.aiFirstCallDelayMinutes);
  }

  if (Object.prototype.hasOwnProperty.call(body, "aiRealTimeOnly")) {
    if (typeof body.aiRealTimeOnly !== "boolean") {
      return res.status(400).json({ message: "aiRealTimeOnly must be a boolean" });
    }
    update.aiRealTimeOnly = body.aiRealTimeOnly;
  }

  if (Object.prototype.hasOwnProperty.call(body, "aiScriptKey")) {
    if (typeof body.aiScriptKey !== "string" || !body.aiScriptKey.trim()) {
      return res.status(400).json({ message: "aiScriptKey must be a non-empty string" });
    }
    const scriptKey = body.aiScriptKey.trim();
    update.aiScriptKey = VALID_SCRIPT_KEYS.includes(scriptKey) ? scriptKey : "default";
  }

  const folder = Object.keys(update).length
    ? await Folder.findOneAndUpdate(
        { _id: new Types.ObjectId(folderId), userEmail: email },
        { $set: update },
        { new: true }
      )
    : existingFolder;

  if (!folder) return res.status(404).json({ message: "Folder not found" });

  const f = folder as any;
  return res.status(200).json({
    success: true,
    aiFirstCallEnabled: f.aiFirstCallEnabled,
    aiFirstCallDelayMinutes: f.aiFirstCallDelayMinutes,
    aiRealTimeOnly: f.aiRealTimeOnly,
    aiScriptKey: f.aiScriptKey,
    aiEnabledAt: f.aiEnabledAt,
  });
}
