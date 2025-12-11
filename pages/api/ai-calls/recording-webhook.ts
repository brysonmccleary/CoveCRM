// pages/api/ai-calls/recording-webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";
import AICallSession from "@/models/AICallSession";
import { Types } from "mongoose";

export const config = { api: { bodyParser: false } };

function parseIntSafe(n?: string | null): number | undefined {
  if (!n) return undefined;
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : undefined;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  // Twilio sends x-www-form-urlencoded
  const raw = await buffer(req);
  const bodyStr = raw.toString("utf8");
  const params = new URLSearchParams(bodyStr);

  await mongooseConnect();

  try {
    const CallSid = params.get("CallSid") || "";
    const RecordingSid = params.get("RecordingSid") || "";
    const RecordingStatus = (params.get("RecordingStatus") || "").toLowerCase();
    const RecordingUrlRaw = params.get("RecordingUrl") || "";
    const RecordingDurationStr = params.get("RecordingDuration") || "";
    const Timestamp = params.get("Timestamp") || undefined;

    const recordingUrl = RecordingUrlRaw
      ? RecordingUrlRaw.endsWith(".mp3") || RecordingUrlRaw.endsWith(".wav")
        ? RecordingUrlRaw
        : `${RecordingUrlRaw}.mp3`
      : "";

    const durationSec = parseIntSafe(RecordingDurationStr);
    const now = Timestamp ? new Date(Timestamp) : new Date();

    const { sessionId, leadId } = req.query as {
      sessionId?: string;
      leadId?: string;
    };

    let aiSession: any = null;
    let userEmail: string | null = null;

    if (sessionId && Types.ObjectId.isValid(String(sessionId))) {
      aiSession = await AICallSession.findById(sessionId).lean();
      if (aiSession?.userEmail) {
        userEmail = String(aiSession.userEmail).toLowerCase();
      }
    }

    const leadObjectId =
      leadId && Types.ObjectId.isValid(String(leadId))
        ? new Types.ObjectId(String(leadId))
        : undefined;

    const existing =
      (CallSid &&
        (await AICallRecording.findOne({ callSid: CallSid }).exec())) ||
      (RecordingSid &&
        (await AICallRecording.findOne({ recordingSid: RecordingSid }).exec())) ||
      null;

    const baseSet: any = {
      recordingSid: RecordingSid || existing?.recordingSid || undefined,
      recordingUrl: recordingUrl || existing?.recordingUrl || undefined,
      durationSec:
        typeof durationSec === "number" ? durationSec : existing?.durationSec,
      updatedAt: now,
    };

    const metaBits: string[] = [];
    if (RecordingStatus) metaBits.push(`recordingStatus=${RecordingStatus}`);
    if (typeof durationSec === "number")
      metaBits.push(`durationSec=${durationSec}`);
    const notesSuffix =
      metaBits.length > 0 ? `Twilio: ${metaBits.join(", ")}` : null;

    let finalRecordingDoc: any = null;

    if (!existing) {
      finalRecordingDoc = await AICallRecording.create({
        userEmail: userEmail || undefined,
        leadId: leadObjectId,
        aiCallSessionId: aiSession?._id,
        callSid: CallSid || RecordingSid || "",
        outcome: "unknown",
        notes: notesSuffix,
        summary: null,
        recordingSid: baseSet.recordingSid,
        recordingUrl: baseSet.recordingUrl,
        durationSec: baseSet.durationSec,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const newNotes =
        notesSuffix && notesSuffix.length
          ? existing.notes
            ? `${existing.notes}\n${notesSuffix}`
            : notesSuffix
          : existing.notes ?? null;

      await AICallRecording.updateOne(
        { _id: existing._id },
        {
          $set: {
            ...baseSet,
            userEmail: existing.userEmail || userEmail || undefined,
            leadId: existing.leadId || leadObjectId,
            aiCallSessionId:
              existing.aiCallSessionId || aiSession?._id || undefined,
            notes: newNotes,
          },
        }
      );

      finalRecordingDoc = {
        ...existing.toObject(),
        ...baseSet,
        notes: newNotes,
      };
    }

    // NOTE: No billing here anymore — billing is handled in call-status-webhook
    // based on full call duration, not just recording duration.

    if (RecordingStatus === "completed") {
      // Future: enqueue AI summarizer to update outcome + summary
    }

    res.status(200).end();
  } catch (err) {
    console.error("❌ AI recording-webhook error:", err);
    res.status(200).end();
  }
}
