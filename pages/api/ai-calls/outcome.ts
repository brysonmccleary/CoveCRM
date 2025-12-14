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

  // ✅ Booking confirmation fields (optional, but REQUIRED if outcome === "booked")
  confirmedDate?: string; // e.g. "2025-12-14" or "Dec 14, 2025"
  confirmedTime?: string; // e.g. "3:30 PM"
  confirmedYes?: boolean; // lead explicitly confirmed "yes that works"
  repeatBackConfirmed?: boolean; // AI repeated date/time and lead confirmed again
}

function isNonEmptyString(v: any) {
  return typeof v === "string" && v.trim().length > 0;
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

    const {
      callSid,
      outcome,
      summary,
      notesAppend,
      confirmedDate,
      confirmedTime,
      confirmedYes,
      repeatBackConfirmed,
    } = (req.body || {}) as OutcomeBody;

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
    const aiCallSessionId = rec.aiCallSessionId as Types.ObjectId | undefined;

    if (!userEmail || !leadId) {
      // Still update recording text fields, but we can't safely move folders
      console.warn(
        "[ai-calls/outcome] Missing userEmail or leadId on AICallRecording; will not move lead."
      );
    }

    // ───────────────────────── Normalize outcome ─────────────────────────
    const allowed: AllowedOutcome[] = [
      "unknown",
      "booked",
      "not_interested",
      "no_answer",
      "callback",
      "do_not_call",
      "disconnected",
    ];

    const prevOutcome: AllowedOutcome = (rec.outcome as any) || "unknown";
    let normalizedOutcome: AllowedOutcome | undefined = undefined;

    let bookedAccepted = true;
    let bookedRejectedReason: string | null = null;

    if (outcome && allowed.includes(outcome)) {
      normalizedOutcome = outcome;
    }

    // ✅ Reliability: NEVER allow regression back to "unknown" if we already have a real outcome.
    if (normalizedOutcome === "unknown" && prevOutcome !== "unknown") {
      normalizedOutcome = undefined;
    }

    // ✅ Enforce appointment cementing server-side:
    // Only allow "booked" when we have explicit confirmation fields.
    //
    // CRITICAL RELIABILITY GUARD:
    // If the lead is ALREADY "booked" from a prior valid outcome, DO NOT downgrade it
    // due to missing confirmation fields on a later retry/partial payload.
    if (normalizedOutcome === "booked") {
      const hasDate = isNonEmptyString(confirmedDate);
      const hasTime = isNonEmptyString(confirmedTime);
      const hasYes = confirmedYes === true;
      const hasRepeat = repeatBackConfirmed === true;

      if (!hasDate || !hasTime || !hasYes || !hasRepeat) {
        if (prevOutcome === "booked") {
          // Keep booked. Do not downgrade an already-booked lead due to partial payloads.
          bookedAccepted = true;
          bookedRejectedReason = null;
          normalizedOutcome = undefined; // preserve prevOutcome
        } else {
          bookedAccepted = false;
          bookedRejectedReason = "booked_rejected_missing_confirmation_fields";

          // Downgrade to callback (actionable) instead of incorrectly marking booked.
          normalizedOutcome = "callback";
        }
      }
    }

    const nextOutcome: AllowedOutcome =
      (normalizedOutcome as any) ?? prevOutcome ?? "unknown";

    // Update recording fields
    if (normalizedOutcome) {
      rec.outcome = normalizedOutcome as any;
    }
    if (typeof summary === "string") {
      rec.summary = summary;
    }

    // Append onto AICallRecording.notes (multi-line allowed)
    const toAppend: string[] = [];
    if (typeof notesAppend === "string" && notesAppend.trim().length > 0) {
      toAppend.push(notesAppend.trim());
    }

    if (!bookedAccepted && bookedRejectedReason) {
      // Add a visible audit note so you can diagnose false-booked attempts quickly.
      const audit = `[AI Dialer] BOOKED rejected: missing confirmation fields (date=${String(
        confirmedDate || ""
      ).trim() || "missing"}, time=${
        String(confirmedTime || "").trim() || "missing"
      }, yes=${String(confirmedYes === true)}, repeatBack=${String(
        repeatBackConfirmed === true
      )})`;
      toAppend.push(audit);
    }

    if (toAppend.length > 0) {
      const appended = toAppend.join("\n");
      rec.notes = rec.notes ? `${rec.notes}\n${appended}` : appended;
    }

    // Store confirmation fields if provided (non-breaking; safe for later audits)
    // Only set if they exist so we don't overwrite prior info.
    if (isNonEmptyString(confirmedDate))
      (rec as any).confirmedDate = confirmedDate!.trim();
    if (isNonEmptyString(confirmedTime))
      (rec as any).confirmedTime = confirmedTime!.trim();
    if (typeof confirmedYes === "boolean") (rec as any).confirmedYes = confirmedYes;
    if (typeof repeatBackConfirmed === "boolean")
      (rec as any).repeatBackConfirmed = repeatBackConfirmed;

    if (!bookedAccepted && bookedRejectedReason) {
      (rec as any).bookedRejectedReason = bookedRejectedReason;
      (rec as any).bookedRejectedAt = new Date();
    }

    rec.updatedAt = new Date();
    await rec.save();

    // ───────────────────────── Session stats (AI-only, idempotent) ─────────────────────────
    if (aiCallSessionId && normalizedOutcome && userEmail) {
      const now = new Date();
      const inc: Record<string, number> = {};
      const set: Record<string, any> = { updatedAt: now };

      if (prevOutcome !== nextOutcome) {
        // Adjust per-outcome counters
        if (prevOutcome !== "unknown") {
          inc[`stats.${prevOutcome}`] = (inc[`stats.${prevOutcome}`] || 0) - 1;
        }
        if (nextOutcome !== "unknown") {
          inc[`stats.${nextOutcome}`] =
            (inc[`stats.${nextOutcome}`] || 0) + 1;
        }

        // Completed only tracks leads where we have a *final* outcome
        if (prevOutcome === "unknown" && nextOutcome !== "unknown") {
          inc["stats.completed"] = (inc["stats.completed"] || 0) + 1;
        } else if (prevOutcome !== "unknown" && nextOutcome === "unknown") {
          inc["stats.completed"] = (inc["stats.completed"] || 0) - 1;
        }
      }

      if (Object.keys(inc).length > 0) {
        await AICallSession.updateOne(
          { _id: aiCallSessionId, userEmail },
          {
            $inc: inc,
            $set: set,
          }
        ).exec();
      }

      // ───────────────────────── Auto-complete session when all leads resolved ─────────────────────────
      try {
        const session = await AICallSession.findOne({
          _id: aiCallSessionId,
          userEmail,
        }).lean();

        if (session) {
          const s: any = session;
          const total: number = typeof s.total === "number" ? s.total : 0;
          const completed: number =
            s.stats && typeof s.stats.completed === "number"
              ? s.stats.completed
              : 0;

          if (total > 0 && completed >= total && s.status !== "completed") {
            await AICallSession.updateOne(
              {
                _id: aiCallSessionId,
                userEmail,
                status: { $ne: "completed" },
              },
              {
                $set: {
                  status: "completed",
                  completedAt: new Date(),
                  updatedAt: new Date(),
                },
              }
            ).exec();

            console.log(
              "[ai-calls/outcome] Marked AI session completed based on stats",
              {
                sessionId: String(aiCallSessionId),
                userEmail,
                total,
                completed,
              }
            );

            // TODO: hook in your Resend email here:
            //  - Load latest stats from session
            //  - Send "Your AI dial session has finished" to userEmail
            //  - Include folder name, total leads, booked, not_interested, no_answer, callback, etc.
          }
        }
      } catch (sessionErr: any) {
        console.warn(
          "[ai-calls/outcome] Failed to auto-complete session by stats (non-blocking):",
          sessionErr?.message || sessionErr
        );
      }
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

    if (userEmail && leadId && nextOutcome) {
      let systemFolderName: string | null = null;

      if (nextOutcome === "booked") {
        systemFolderName = "Booked Appointment";
      } else if (nextOutcome === "not_interested") {
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

        targetFolderId = folderDoc?._id as any;

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

    // ───────────────────────── Timeline / notes on Lead ─────────────────────────
    if (userEmail && leadId) {
      try {
        const now = new Date();
        const outcomeLabel = nextOutcome || "unknown";
        const baseMsg = `🤖 AI Dialer outcome: ${outcomeLabel.replace("_", " ")}`;
        const extra =
          typeof summary === "string" && summary.trim().length > 0
            ? ` – ${summary.trim()}`
            : "";
        const message = baseMsg + extra;

        const historyEntry = {
          type: "ai_outcome",
          message,
          timestamp: now,
          userEmail,
          meta: {
            outcome: outcomeLabel,
            callSid,
            recordingId: rec._id,
            bookedAccepted,
            bookedRejectedReason,
            confirmedDate: isNonEmptyString(confirmedDate)
              ? confirmedDate!.trim()
              : undefined,
            confirmedTime: isNonEmptyString(confirmedTime)
              ? confirmedTime!.trim()
              : undefined,
            confirmedYes: typeof confirmedYes === "boolean" ? confirmedYes : undefined,
            repeatBackConfirmed:
              typeof repeatBackConfirmed === "boolean"
                ? repeatBackConfirmed
                : undefined,
          },
        };

        // Load lead so we can APPEND notesAppend instead of overwriting
        const lead = await Lead.findOne({
          _id: leadId,
          $or: [
            { userEmail: userEmail },
            { ownerEmail: userEmail },
            { user: userEmail },
          ],
        }).exec();

        if (lead) {
          // History (idempotent per callSid)
          const existingHistory: any[] = Array.isArray((lead as any).history)
            ? (lead as any).history
            : [];

          const alreadyHasEntry = existingHistory.some((h: any) => {
            const meta = h?.meta || {};
            return h?.type === "ai_outcome" && meta?.callSid === callSid;
          });

          if (!alreadyHasEntry) {
            existingHistory.push(historyEntry);
            (lead as any).history = existingHistory;
          }

          // Notes append behavior (preserve existing behavior)
          if (typeof notesAppend === "string" && notesAppend.trim().length > 0) {
            const appendText = notesAppend.trim();
            const existingNotes =
              ((lead as any).notes as string | undefined) ||
              ((lead as any).Notes as string | undefined) ||
              "";

            const combined =
              existingNotes && existingNotes.trim().length > 0
                ? `${existingNotes}\n${appendText}`
                : appendText;

            (lead as any).notes = combined;
            (lead as any).Notes = combined;
          }

          // Also append the booked rejection audit note if applicable (safe + small)
          if (!bookedAccepted && bookedRejectedReason) {
            const existingNotes =
              ((lead as any).notes as string | undefined) ||
              ((lead as any).Notes as string | undefined) ||
              "";

            const auditLine = `[AI Dialer] BOOKED rejected: missing confirmation (CallSid=${callSid})`;
            if (
              !existingNotes.includes(`CallSid=${callSid}`) ||
              !existingNotes.includes("BOOKED rejected")
            ) {
              const combined =
                existingNotes && existingNotes.trim().length > 0
                  ? `${existingNotes}\n${auditLine}`
                  : auditLine;
              (lead as any).notes = combined;
              (lead as any).Notes = combined;
            }
          }

          (lead as any).updatedAt = now;
          await lead.save();
        }
      } catch (err) {
        console.warn(
          "[ai-calls/outcome] Failed to append AI outcome to lead history (non-blocking):",
          (err as any)?.message || err
        );
      }
    }

    return res.status(200).json({
      ok: true,
      recordingId: rec._id,
      outcome: rec.outcome,
      bookedAccepted,
      bookedRejectedReason,
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
