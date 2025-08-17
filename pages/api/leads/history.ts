// /pages/api/leads/history.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import Call from "@/models/Call";
import { Types } from "mongoose";

type ApiEvent =
  | {
      type: "sms";
      id: string;
      dir: "inbound" | "outbound" | "ai";
      text: string;
      date: string;
      sid?: string;
      status?: string;
    }
  | {
      type: "call";
      id: string;
      date: string;
      durationSec?: number;
      status?: string;
      recordingUrl?: string;
      summary?: string;
      sentiment?: string;
    }
  | { type: "note"; id: string; date: string; text: string }
  | { type: "status"; id: string; date: string; to?: string };

function coerceDateISO(d?: any): string {
  const dt = d ? new Date(d) : new Date();
  return isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const session = await getServerSession(req, res, authOptions as any);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const leadId = String(req.query.id || "").trim();
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const before = req.query.before ? new Date(String(req.query.before)) : null;

  if (!leadId) {
    res.status(400).json({ message: "Missing lead id" });
    return;
  }

  await dbConnect();

  const leadDoc: any = await Lead.findOne({ _id: leadId, userEmail }).lean();
  if (!leadDoc) {
    res.status(404).json({ message: "Lead not found" });
    return;
  }

  const events: ApiEvent[] = [];
  const cutoff = before || new Date();

  // ---------- SMS (Message collection) ----------
  try {
    const msgQuery: any = {
      userEmail,
      leadId,
      createdAt: { $lte: cutoff },
    };

    const msgs: any[] = await Message.find(msgQuery)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    for (const m of msgs) {
      events.push({
        type: "sms",
        id: String(m._id),
        dir: (m.direction || "inbound") as "inbound" | "outbound" | "ai",
        text: m.body || m.text || "",
        date: coerceDateISO(m.createdAt || m.date),
        sid: m.sid,
        status: m.status,
      });
    }
  } catch (e) {
    // If Message model/collection isn't present, silently skip
    // console.warn("history: Message lookup skipped:", e);
  }

  // ---------- Calls (Call collection) ----------
  try {
    const idObj = Types.ObjectId.isValid(leadId) ? new Types.ObjectId(leadId) : null;
    const callQuery: any = {
      userEmail,
      $or: [{ leadId }, ...(idObj ? [{ leadId: idObj }] : [])],
      $orTime: [
        { startedAt: { $lte: cutoff } },
        { completedAt: { $lte: cutoff } },
        { createdAt: { $lte: cutoff } },
      ],
    };

    // Mongo doesn't allow custom key $orTime, so expand inline:
    const { $orTime, ...base } = callQuery;
    const finalQuery = {
      ...base,
      $or: $orTime,
    };

    const calls: any[] = await Call.find(finalQuery)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    for (const c of calls) {
      // choose a sensible timestamp
      const when = c.startedAt || c.completedAt || c.createdAt;
      const dur = typeof c.duration === "number" ? c.duration : undefined;
      const talk = typeof c.talkTime === "number" ? c.talkTime : undefined;
      let status: string | undefined;
      if (c.completedAt) {
        status = (talk ?? 0) > 0 ? "completed" : "no-answer";
      }

      events.push({
        type: "call",
        id: String(c._id),
        date: coerceDateISO(when),
        durationSec: dur,
        status,
        recordingUrl: c.recordingUrl,
        summary: c.aiSummary,
        sentiment: c.aiSentiment,
      });
    }
  } catch (e) {
    console.warn("history: Call lookup error:", (e as any)?.message || e);
  }

  // ---------- Embedded transcripts as notes ----------
  if (Array.isArray(leadDoc.callTranscripts)) {
    for (const t of leadDoc.callTranscripts) {
      events.push({
        type: "note",
        id: `${leadDoc._id}-tx-${(t.createdAt && new Date(t.createdAt).getTime()) || Math.random()}`,
        date: coerceDateISO(t.createdAt),
        text: t.text || "",
      });
    }
  }

  // ---------- Current status marker ----------
  events.push({
    type: "status",
    id: `${leadDoc._id}-status`,
    date: coerceDateISO(leadDoc.updatedAt || leadDoc.createdAt),
    to: leadDoc.status || "New",
  });

  // Sort DESC by date and paginate
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const sliced = events.slice(0, limit);

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    lead: {
      _id: String(leadDoc._id),
      firstName: leadDoc["First Name"] || "",
      lastName: leadDoc["Last Name"] || "",
      phone: leadDoc.Phone || "",
      email: leadDoc.Email || "",
      state: leadDoc.State || "",
      status: leadDoc.status || "New",
      folderId: leadDoc.folderId ? String(leadDoc.folderId) : null,
    },
    events: sliced,
    nextBefore: sliced.length ? sliced[sliced.length - 1].date : null,
  });
  return;
}
