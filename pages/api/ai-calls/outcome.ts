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

function normalizeBulletLines(input: string | undefined | null): string[] {
  const raw = (input || "").trim();
  if (!raw) return [];

  // Support lines starting with "* " (current prompt), "-" or "•"
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if (l.startsWith("* ")) return l.slice(2).trim();
      if (l.startsWith("- ")) return l.slice(2).trim();
      if (l.startsWith("• ")) return l.slice(2).trim();
      return l;
    })
    .filter(Boolean);

  // If it's one long paragraph, split into short bullets by sentence-ish boundaries
  if (lines.length === 1 && lines[0].length > 140) {
    const s = lines[0]
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
    return s.slice(0, 8);
  }

  return lines.slice(0, 12);
}

function buildCloseStyleOverviewBlock(args: {
  callSid: string;
  outcome: string;
  summary?: string;
  notesAppend?: string;
  confirmedDate?: string;
  confirmedTime?: string;
  confirmedYes?: boolean;
  repeatBackConfirmed?: boolean;
}): string {
  const {
    callSid,
    outcome,
    summary,
    notesAppend,
    confirmedDate,
    confirmedTime,
    confirmedYes,
    repeatBackConfirmed,
  } = args;

  const header = `[AI Dialer Outcome] CallSid=${callSid} • outcome=${outcome}`;

  const bullets: string[] = [];

  // Summary → bullets
  if (isNonEmptyString(summary)) {
    const summaryBullets = normalizeBulletLines(summary);
    if (summaryBullets.length > 0) {
      for (const b of summaryBullets.slice(0, 4)) {
        bullets.push(b);
      }
    } else {
      bullets.push(summary!.trim());
    }
  }

  // notesAppend → bullets (Close-style)
  const noteBullets = normalizeBulletLines(notesAppend);
  for (const b of noteBullets.slice(0, 8)) {
    // avoid duplicating exact summary lines
    if (!bullets.some((x) => x.toLowerCase() === b.toLowerCase())) {
      bullets.push(b);
    }
  }

  // Booking confirmation info as explicit bullets (if present)
  if (outcome === "booked") {
    const date = isNonEmptyString(confirmedDate) ? confirmedDate!.trim() : "";
    const time = isNonEmptyString(confirmedTime) ? confirmedTime!.trim() : "";
    if (date || time) {
      bullets.push(`Appointment confirmed: ${[date, time].filter(Boolean).join(" @ ")}`);
    }
    if (confirmedYes === true) bullets.push(`Lead explicitly confirmed the time works (yes)`);
    if (repeatBackConfirmed === true) bullets.push(`AI repeated date/time and lead confirmed again`);
  }

  // Always ensure we have at least one bullet to avoid empty blocks
  if (bullets.length === 0) {
    bullets.push("Call ended without a detailed AI summary payload.");
  }

  // Close-style formatting: "• " bullets
  const body = bullets.map((b) => `• ${b}`).join("\n");

  // A footer marker used for idempotency (prevents spam on retries)
  const marker = `[AI_DIALER_NOTES_APPLIED] CallSid=${callSid}`;

  return `${header}\n${body}\n${marker}`;
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

    // Build the Close-style overview block ONCE (used for both recording + lead notes)
    const overviewBlock = buildCloseStyleOverviewBlock({
      callSid,
      outcome: nextOutcome,
      summary,
      notesAppend,
      confirmedDate,
      confirmedTime,
      confirmedYes,
      repeatBackConfirmed,
    });

    const marker = `[AI_DIALER_NOTES_APPLIED] CallSid=${callSid}`;
    const alreadyAppliedToRecording =
      typeof rec.notes === "string" && rec.notes.includes(marker);

    // Update recording fields
    if (normalizedOutcome) {
      rec.outcome = normalizedOutcome as any;
    }
    if (typeof summary === "string") {
      rec.summary = summary;
    }

    // ✅ Prevent AICallRecording.notes spam:
    // Only append the overview block once per CallSid.
    if (!alreadyAppliedToRecording) {
      rec.notes = rec.notes ? `${rec.notes}\n${overviewBlock}` : overviewBlock;
    } else {
      // Still allow updating summary/outcome fields, but do not append notes again.
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

            // TODO: hook in your Resend email here
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

          // ✅ Prevent LEAD notes spam:
          // Only append our Close-style block once, using the marker line.
          const existingNotes =
            ((lead as any).notes as string | undefined) ||
            ((lead as any).Notes as string | undefined) ||
            "";

          const alreadyHasMarker =
            typeof existingNotes === "string" && existingNotes.includes(marker);

          if (!alreadyHasMarker) {
            const combined =
              existingNotes && existingNotes.trim().length > 0
                ? `${existingNotes}\n\n${overviewBlock}`
                : overviewBlock;

            (lead as any).notes = combined;
            (lead as any).Notes = combined;
          }

          (lead as any).updatedAt = now;
          await lead.save();
        }
      } catch (err) {
        console.warn(
          "[ai-calls/outcome] Failed to append AI outcome to lead history/notes (non-blocking):",
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
      notesAppliedOnce: !alreadyAppliedToRecording,
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
