// /pages/api/create-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const {
      name,
      aiFirstCallEnabled,
      aiFirstCallDelayMinutes,
      aiRealTimeOnly,
      aiScriptKey,
    } = req.body as {
      name?: string;
      aiFirstCallEnabled?: boolean;
      aiFirstCallDelayMinutes?: number;
      aiRealTimeOnly?: boolean;
      aiScriptKey?: string;
    };

    if (!name || name.trim() === "") {
      return res.status(400).json({ message: "Folder name is required" });
    }

    const VALID_SCRIPT_KEYS = [
      "default",
      "final_expense",
      "mortgage_protection",
      "iul_cash_value",
      "veteran_leads",
      "trucker_leads",
      "generic_life",
    ];

    const aiEnabled = aiFirstCallEnabled === true;
    const rawDelay = typeof aiFirstCallDelayMinutes === "number" ? aiFirstCallDelayMinutes : 1;
    const clampedDelay = Math.min(60, Math.max(0, Math.round(rawDelay)));
    const realTimeOnly = aiRealTimeOnly !== false; // default true
    const scriptKeyRaw = typeof aiScriptKey === "string" ? aiScriptKey.trim() : "default";
    const scriptKey = VALID_SCRIPT_KEYS.includes(scriptKeyRaw) ? scriptKeyRaw : "default";

    await dbConnect();
    const newFolder = await Folder.create({
      name: name.trim(),
      userEmail: session.user.email,
      createdAt: new Date(),
      aiFirstCallEnabled: aiEnabled,
      aiFirstCallDelayMinutes: clampedDelay,
      aiRealTimeOnly: realTimeOnly,
      aiScriptKey: scriptKey,
      aiEnabledAt: aiEnabled ? new Date() : null,
    });

    res.status(201).json({
      message: "Folder created successfully",
      folderId: newFolder._id,
    });
  } catch (error) {
    console.error("Error creating folder:", error);
    res.status(500).json({ message: "Failed to create folder" });
  }
}
