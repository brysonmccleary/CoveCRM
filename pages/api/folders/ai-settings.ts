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

  const { folderId, aiFirstCallEnabled, aiFirstCallDelayMinutes, aiRealTimeOnly, aiScriptKey, aiEnabledAt } = req.body || {};

  if (!folderId || !Types.ObjectId.isValid(folderId)) {
    return res.status(400).json({ message: "Invalid folderId" });
  }

  const VALID_SCRIPT_KEYS = ["default","final_expense","mortgage_protection","iul_cash_value","veteran_leads","trucker_leads","generic_life"];

  const update: any = { aiFirstCallEnabled: !!aiFirstCallEnabled };

  // aiEnabledAt: set when enabling, clear when disabling
  if (aiFirstCallEnabled && aiEnabledAt) {
    update.aiEnabledAt = new Date(aiEnabledAt);
  } else if (aiFirstCallEnabled && !aiEnabledAt) {
    update.aiEnabledAt = new Date();
  } else if (!aiFirstCallEnabled) {
    update.aiEnabledAt = null;
  }

  // aiFirstCallDelayMinutes: clamp 0–60
  if (typeof aiFirstCallDelayMinutes === "number") {
    update.aiFirstCallDelayMinutes = Math.min(60, Math.max(0, Math.round(aiFirstCallDelayMinutes)));
  }

  // aiRealTimeOnly: boolean
  if (typeof aiRealTimeOnly === "boolean") {
    update.aiRealTimeOnly = aiRealTimeOnly;
  }

  // aiScriptKey: validate against allowlist
  if (typeof aiScriptKey === "string" && aiScriptKey) {
    update.aiScriptKey = VALID_SCRIPT_KEYS.includes(aiScriptKey) ? aiScriptKey : "default";
  }

  const folder = await Folder.findOneAndUpdate(
    { _id: new Types.ObjectId(folderId), userEmail: email },
    { $set: update },
    { new: true }
  );

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
