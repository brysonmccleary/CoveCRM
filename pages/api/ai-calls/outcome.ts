// pages/api/ai-calls/outcome.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";
import AICallSession from "@/models/AICallSession";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder"; // same model used elsewhere
import Call from "@/models/Call";
import { Types } from "mongoose";

const AI_DIALER_AGENT_KEY = (process.env.AI_DIALER_AGENT_KEY || "").trim();

// OpenAI (used ONLY for Close-style call overview JSON generation; no audio changes)
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = (process.env.AI_OVERVIEW_MODEL || "gpt-4o-mini").trim();

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
      bullets.push(
        `Appointment confirmed: ${[date, time].filter(Boolean).join(" @ ")}`
      );
    }
    if (confirmedYes === true)
      bullets.push(`Lead explicitly confirmed the time works (yes)`);
    if (repeatBackConfirmed === true)
      bullets.push(`AI repeated date/time and lead confirmed again`);
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

// ───────────────────────── Close-style AI Overview (LOCKED SCHEMA) ─────────────────────────

type AICallOverviewOutcome =
  | "Booked"
  | "Callback"
  | "Not Interested"
  | "No Answer"
  | "Voicemail"
  | "Other";

type AICallOverviewSentiment = "Positive" | "Neutral" | "Negative";

interface AICallOverview {
  overviewBullets: string[]; // 3–6 bullets (top summary)
  keyDetails: string[]; // household, coverage, timing
  objections: string[]; // objections + responses
  questions: string[]; // questions asked by lead
  nextSteps: string[]; // follow-ups / actions
  outcome: AICallOverviewOutcome;
  appointmentTime?: string; // ISO or display string if booked
  sentiment?: AICallOverviewSentiment;
  generatedAt: string; // ISO timestamp
  version: 1;
}

function mapOutcomeToOverview(outcome: AllowedOutcome): AICallOverviewOutcome {
  if (outcome === "booked") return "Booked";
  if (outcome === "callback") return "Callback";
  if (outcome === "not_interested") return "Not Interested";
  if (outcome === "no_answer") return "No Answer";
  // If you later have explicit voicemail detection in metadata, map it there.
  if (outcome === "disconnected" || outcome === "do_not_call") return "Other";
  return "Other";
}

function clampBulletsTotal(o: AICallOverview): AICallOverview {
  // Hard rule: No more than 12 total bullets across all sections.
  const fields: (keyof Pick<
    AICallOverview,
    "overviewBullets" | "keyDetails" | "objections" | "questions" | "nextSteps"
  >)[] = ["overviewBullets", "keyDetails", "objections", "questions", "nextSteps"];

  // Normalize arrays
  for (const f of fields) {
    const arr = Array.isArray(o[f]) ? o[f] : [];
    o[f] = arr.map((x) => String(x || "").trim()).filter(Boolean);
  }

  let total =
    o.overviewBullets.length +
    o.keyDetails.length +
    o.objections.length +
    o.questions.length +
    o.nextSteps.length;

  if (total <= 12) return o;

  // Trim in a Close-ish priority order: keep overviewBullets first
  const trimOrder: (keyof typeof o)[] = [
    "nextSteps",
    "questions",
    "objections",
    "keyDetails",
    "overviewBullets",
  ];

  for (const f of trimOrder) {
    if (total <= 12) break;
    const arr = (o as any)[f] as string[];
    while (Array.isArray(arr) && arr.length > 0 && total > 12) {
      arr.pop();
      total -= 1;
    }
  }

  return o;
}

function buildLockedPrompt(args: {
  transcript: string;
  leadName?: string;
  leadType?: string;
  durationSeconds?: number;
  outcomeLabel?: string;
  appointmentTime?: string;
}): string {
  const schema = `interface AICallOverview {
  overviewBullets: string[];       // 3–6 bullets (top summary)
  keyDetails: string[];             // household, coverage, timing
  objections: string[];             // objections + responses
  questions: string[];              // questions asked by lead
  nextSteps: string[];              // follow-ups / actions
  outcome: "Booked" | "Callback" | "Not Interested" | "No Answer" | "Voicemail" | "Other";
  appointmentTime?: string;         // ISO or display string if booked
  sentiment?: "Positive" | "Neutral" | "Negative";
  generatedAt: string;              // ISO timestamp
  version: 1;
}`;

  const metaLines: string[] = [];
  if (args.leadName) metaLines.push(`- lead name: ${args.leadName}`);
  if (args.leadType) metaLines.push(`- lead type: ${args.leadType}`);
  if (typeof args.durationSeconds === "number")
    metaLines.push(`- call duration: ${args.durationSeconds}s`);
  if (args.outcomeLabel) metaLines.push(`- call outcome (if known): ${args.outcomeLabel}`);
  if (args.appointmentTime)
    metaLines.push(`- appointment time (if booked): ${args.appointmentTime}`);

  return `You are generating a CRM call overview for a sales agent.

Rules:
- Output ONLY valid JSON matching the provided schema.
- DO NOT include explanations.
- DO NOT include paragraphs.
- Every field must be concise bullet points.
- No more than 12 total bullets across all sections.
- Bullets must be factual, not salesy.
- If something did not occur, return an empty array for that field.

Goal:
Match the style of Close CRM's AI Call Overview.

Schema:
${schema}

Transcript:
${args.transcript}

Call metadata:
${metaLines.length ? metaLines.join("\n") : "- (none)"}`;
}

async function generateCloseStyleOverview(args: {
  transcript: string;
  leadName?: string;
  leadType?: string;
  durationSeconds?: number;
  outcome: AllowedOutcome;
  appointmentTime?: string;
}): Promise<AICallOverview | null> {
  if (!OPENAI_API_KEY) {
    console.warn("[ai-calls/outcome] OPENAI_API_KEY missing; skipping aiOverview generation");
    return null;
  }

  const prompt = buildLockedPrompt({
    transcript: args.transcript,
    leadName: args.leadName,
    leadType: args.leadType,
    durationSeconds: args.durationSeconds,
    outcomeLabel: mapOutcomeToOverview(args.outcome),
    appointmentTime: args.appointmentTime,
  });

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    console.warn("[ai-calls/outcome] OpenAI overview generation failed", {
      status: resp.status,
      body: txt ? txt.slice(0, 500) : "",
    });
    return null;
  }

  const data: any = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;

  if (!isNonEmptyString(content)) return null;

  let parsed: any = null;
  try {
    parsed = JSON.parse(String(content));
  } catch {
    // If model returns extra text (shouldn't), try to extract JSON block
    const s = String(content);
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(s.slice(first, last + 1));
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") return null;

  const overview: AICallOverview = {
    overviewBullets: Array.isArray(parsed.overviewBullets) ? parsed.overviewBullets : [],
    keyDetails: Array.isArray(parsed.keyDetails) ? parsed.keyDetails : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
    outcome: (parsed.outcome as any) || mapOutcomeToOverview(args.outcome),
    appointmentTime: isNonEmptyString(parsed.appointmentTime)
      ? String(parsed.appointmentTime)
      : args.appointmentTime,
    sentiment: isNonEmptyString(parsed.sentiment) ? String(parsed.sentiment) : undefined,
    generatedAt: new Date().toISOString(),
    version: 1,
  };

  return clampBulletsTotal(overview);
}

function getTranscriptFromRecording(rec: any): string {
  const candidates = [
    rec?.transcript,
    rec?.transcriptText,
    rec?.fullTranscript,
    rec?.transcription,
    rec?.text,
  ];

  for (const c of candidates) {
    if (isNonEmptyString(c)) return String(c).trim();
  }
  return "";
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

    // ───────────────────────── Close-style AI Overview storage on Call (ONCE) ─────────────────────────
    let aiOverviewSaved = false;
    let aiOverviewSkippedReason: string | null = null;

    if (userEmail && callSid) {
      try {
        const callDoc: any = await (Call as any).findOne({
          callSid: callSid,
          userEmail: userEmail,
        }).exec();

        if (!callDoc) {
          aiOverviewSkippedReason = "call_not_found";
        } else if ((callDoc as any).aiOverviewReady === true && (callDoc as any).aiOverview) {
          aiOverviewSkippedReason = "already_ready";
        } else {
          const transcript = getTranscriptFromRecording(rec);

          if (!isNonEmptyString(transcript)) {
            aiOverviewSkippedReason = "missing_transcript";
          } else {
            // Metadata (best-effort)
            const leadName = (rec as any)?.leadName || (rec as any)?.contactName || undefined;
            const leadType = (rec as any)?.leadType || undefined;
            const durationSeconds =
              typeof (rec as any)?.duration === "number"
                ? (rec as any).duration
                : typeof (callDoc as any)?.duration === "number"
                ? (callDoc as any).duration
                : undefined;

            const appt =
              nextOutcome === "booked"
                ? [confirmedDate, confirmedTime].filter(Boolean).join(" ")
                : undefined;

            const generated = await generateCloseStyleOverview({
              transcript,
              leadName,
              leadType,
              durationSeconds,
              outcome: nextOutcome,
              appointmentTime: appt || undefined,
            });

            if (generated) {
              (callDoc as any).aiOverview = generated;
              (callDoc as any).aiOverviewReady = true;
              (callDoc as any).updatedAt = new Date();
              await callDoc.save();
              aiOverviewSaved = true;
            } else {
              aiOverviewSkippedReason = "generation_failed";
            }
          }
        }
      } catch (e: any) {
        console.warn("[ai-calls/outcome] aiOverview save failed (non-blocking):", e?.message || e);
        aiOverviewSkippedReason = "save_error";
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

      // New: overview storage status (debuggable, non-breaking)
      aiOverviewSaved,
      aiOverviewSkippedReason,
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
