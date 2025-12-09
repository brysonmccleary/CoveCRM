// pages/api/ai-calls/outcome.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";
import AICallSession from "@/models/AICallSession";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder"; // same model used elsewhere
import { Types } from "mongoose";

const AI_DIALER_AGENT_KEY = (process.env.AI_DIALER_AGENT_KEY || "").trim();

type AllowedOutcome =
  | "unknown"
  | "booked"
  | "not_interested"
  | "no_answer"
  | "callback"
  | "do_not_call"
  | "disconnected";

interface OutcomeBody {
  callSid?: string;
  outcome?: AllowedOutcome;
  summary?: string;
  notesAppend?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ ok: false, message: "Method not allowed" });
  }

  if (!AI_DIALER_AGENT_KEY) {
    return res
      .status(500)
      .json({ ok: false, message: "AI_DIALER_AGENT_KEY not configured" });
  }

  const hdrKey = (req.headers["x-agent-key"] || "") as string;
  if (!hdrKey || hdrKey !== AI_DIALER_AGENT_KEY) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  try {
    await mongooseConnect();

    const { callSid, outcome, summary, notesAppend } =
      (req.body || {}) as OutcomeBody;

    if (!callSid) {
      return res
        .status(400)
        .json({ ok: false, message: "callSid is required" });
    }

    const rec = await AICallRecording.findOne({ callSid }).exec();
    if (!rec) {
      return res
        .status(404)
        .json({ ok: false, message: "Recording not found for callSid" });
    }

    const userEmail = (rec.userEmail || "").toLowerCase();
    const leadId = rec.leadId as Types.ObjectId | undefined;
    const aiCallSessionId = rec.aiCallSessionId as
      | Types.ObjectId
      | undefined;

    if (!userEmail || !leadId) {
      // Still update recording text fields, but we can't safely move folders
      console.warn(
        "[ai-calls/outcome] Missing userEmail or leadId on AICallRecording; will not move lead."
      );
    }

    // ───────────────────────── Normalize outcome ─────────────────────────
    let normalizedOutcome: AllowedOutcome | undefined = undefined;
    if (outcome) {
      const allowed: AllowedOutcome[] = [
        "unknown",
        "booked",
        "not_interested",
        "no_answer",
        "callback",
        "do_not_call",
        "disconnected",
      ];
      if (allowed.includes(outcome)) {
        normalizedOutcome = outcome;
      }
    }

    // Update recording fields
    if (normalizedOutcome) {
      rec.outcome = normalizedOutcome;
    }
    if (typeof summary === "string") {
      rec.summary = summary;
    }
    if (typeof notesAppend === "string" && notesAppend.trim().length > 0) {
      rec.notes = rec.notes
        ? `${rec.notes}\n${notesAppend.trim()}`
        : notesAppend.trim();
    }
    rec.updatedAt = new Date();
    await rec.save();

    // ───────────────────────── Session stats (AI-only) ─────────────────────────
    if (aiCallSessionId && normalizedOutcome) {
      const statsUpdate: any = { $set: { updatedAt: new Date() } };
      if (!statsUpdate.$inc) statsUpdate.$inc = {};
      statsUpdate.$inc["stats.completed"] = 1;
      statsUpdate.$inc[`stats.${normalizedOutcome}`] = 1;

      await AICallSession.findByIdAndUpdate(
        aiCallSessionId,
        statsUpdate
      ).exec();
    }

    // ───────────────────────── Move lead to resolution folder ─────────────────────────
    // Rules:
    //  - If AI is NOT 100% sure, you keep it in the same folder (handled by your agent).
    //  - When the AI DOES send a final outcome:
    //        "booked"        → "Booked Appointment" system folder
    //        "not_interested"→ "Not Interested" system folder
    //
    // Everything else stays put for now.
    let moved = false;
    let targetFolderId: Types.ObjectId | null = null;

    if (userEmail && leadId && normalizedOutcome) {
      let systemFolderName: string | null = null;

      if (normalizedOutcome === "booked") {
        systemFolderName = "Booked Appointment";
      } else if (normalizedOutcome === "not_interested") {
        systemFolderName = "Not Interested";
      }

      if (systemFolderName) {
        // Find or create the appropriate system folder for this user
        const folderDoc =
          (await Folder.findOne({
            userEmail,
            name: systemFolderName,
          }).exec()) ||
          (await Folder.create({
            userEmail,
            name: systemFolderName,
            isSystem: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          }));

        targetFolderId = folderDoc._id;

        const updateResult = await Lead.updateOne(
          {
            _id: leadId,
            $or: [
              { userEmail: userEmail },
              { ownerEmail: userEmail },
              { user: userEmail },
            ],
          },
          {
            $set: {
              folderId: targetFolderId,
              updatedAt: new Date(),
            },
          }
        ).exec();

        moved = !!updateResult.modifiedCount;
      }
    }

    return res.status(200).json({
      ok: true,
      recordingId: rec._id,
      outcome: rec.outcome,
      moved,
      targetFolderId,
    });
  } catch (err: any) {
    console.error("[ai-calls/outcome] error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      message: "Failed to process AI outcome",
      error: err?.message || String(err),
    });
  }
}
