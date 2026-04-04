// pages/api/calls/ai-result.ts
// ⚠️  LEGACY ROUTE — NOT called by the current AI voice server.
// The canonical AI outcome path is /api/ai-calls/outcome.ts (called by ai-voice-server/index.ts).
// This route is retained for compatibility only. Do NOT add new business logic here.
// All new outcome handling (DNC, booking, nudges) belongs in /api/ai-calls/outcome.ts.
//
// POST — record AI call result, create Booking if booked, create FollowUpNudge
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import CallLog from "@/models/CallLog";
import Booking from "@/models/Booking";
import FollowUpNudge from "@/models/FollowUpNudge";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { Types } from "mongoose";
import { queueLeadMemoryHook } from "@/lib/ai/memory/queueLeadMemoryHook";

const COVECRM_API_SECRET = process.env.COVECRM_API_SECRET || "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers["x-api-secret"] || req.headers["authorization"];
  const token = Array.isArray(authHeader) ? authHeader[0] : authHeader || "";
  const bare = token.replace(/^Bearer\s+/i, "");
  if (!COVECRM_API_SECRET || bare !== COVECRM_API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    userEmail,
    leadId,
    phoneNumber,
    callSid,
    outcome,        // "booked" | "not_interested" | "do_not_call" | "disconnected" | "voicemail"
    summary,
    durationSeconds,
    appointmentDate, // ISO string for booked appointments
    appointmentTimezone,
  } = req.body || {};

  if (!userEmail || !outcome) {
    return res.status(400).json({ error: "userEmail and outcome are required" });
  }

  await mongooseConnect();

  const now = new Date();

  // 1. Write CallLog
  try {
    const callLog = await CallLog.create({
      userEmail: userEmail.toLowerCase(),
      leadId: leadId && Types.ObjectId.isValid(leadId) ? new Types.ObjectId(leadId) : undefined,
      phoneNumber: phoneNumber || "",
      direction: "outbound",
      kind: "ai_call",
      status: outcome,
      durationSeconds: durationSeconds || 0,
      timestamp: now,
    });
    if (leadId && Types.ObjectId.isValid(leadId) && typeof summary === "string" && summary.trim()) {
      queueLeadMemoryHook({
        userEmail: userEmail.toLowerCase(),
        leadId: String(leadId),
        type: "call",
        body: summary.trim(),
        sourceId: String(callLog._id),
      });
    }
  } catch (err: any) {
    console.error("[ai-result] CallLog create error:", err?.message);
  }

  // 2. If booked — create a Booking + move to Booked Appointment folder
  let booking = null;
  if (outcome === "booked" && appointmentDate) {
    try {
      // Resolve agent + lead contact info
      const lead = leadId && Types.ObjectId.isValid(leadId)
        ? await Lead.findOne({
            _id: leadId,
            $or: [{ userEmail }, { ownerEmail: userEmail }, { user: userEmail }],
          }).lean() as any
        : null;

      // Duplicate booking prevention: skip if lead already has an appointmentTime
      if (lead?.appointmentTime) {
        console.info(`[ai-result] Lead ${leadId} already has appointmentTime — skipping duplicate booking`);
      } else {
        const User = (await import("@/models/User")).default;
        const agent = await User.findOne({ email: userEmail.toLowerCase() }).lean() as any;

        booking = await Booking.create({
          leadEmail: lead?.Email || lead?.email || "",
          leadPhone: lead?.Phone || lead?.phone || phoneNumber || "",
          agentEmail: userEmail.toLowerCase(),
          agentPhone: agent?.agentPhone || "",
          date: new Date(appointmentDate),
          timezone: appointmentTimezone || agent?.bookingTimezone || "America/Phoenix",
          reminderSent: {},
          noShow: false,
        });

        // Set appointmentTime on lead and move to Booked Appointment folder
        if (lead) {
          let bookedFolder = await Folder.findOne({ userEmail: userEmail.toLowerCase(), name: "Booked Appointment" });
          if (!bookedFolder) bookedFolder = await Folder.create({ userEmail: userEmail.toLowerCase(), name: "Booked Appointment" });
          await Lead.updateOne(
            { _id: lead._id },
            { $set: { appointmentTime: new Date(appointmentDate), folderId: bookedFolder._id, status: "Booked Appointment" } }
          );
        }
      }
    } catch (err: any) {
      console.error("[ai-result] Booking create error:", err?.message);
    }
  }

  // 2b. Move to system folders based on disposition
  if (leadId && Types.ObjectId.isValid(leadId)) {
    try {
      let systemFolderName: string | null = null;
      if (outcome === "not_interested") systemFolderName = "Not Interested";
      else if (outcome === "do_not_call") systemFolderName = "Do Not Contact";

      if (systemFolderName) {
        let sysFolder = await Folder.findOne({ userEmail: userEmail.toLowerCase(), name: systemFolderName });
        if (!sysFolder) sysFolder = await Folder.create({ userEmail: userEmail.toLowerCase(), name: systemFolderName });
        const leadUpdate: Record<string, any> = { folderId: sysFolder._id, status: systemFolderName };
        // Durable DNC flag — prevents future AI dial session from calling this lead
        if (outcome === "do_not_call") {
          leadUpdate.doNotCall = true;
          leadUpdate.doNotCallAt = new Date();
        }
        await Lead.updateOne({ _id: leadId }, { $set: leadUpdate });
      }
    } catch (err: any) {
      console.error("[ai-result] Folder move error:", err?.message);
    }
  }

  // 3. Create FollowUpNudge based on outcome
  let nudgeMessage = "";
  let nudgePriority: "high" | "medium" | "low" = "medium";

  if (outcome === "booked") {
    nudgeMessage = `AI call booked an appointment${summary ? `: ${summary}` : ""}. Confirm and prepare for the meeting.`;
    nudgePriority = "high";
  } else if (outcome === "not_interested") {
    nudgeMessage = `AI call — lead not interested. Consider re-engaging in 30+ days.`;
    nudgePriority = "low";
  } else if (outcome === "do_not_call") {
    nudgeMessage = `Lead requested no further calls during AI call. Mark DNC.`;
    nudgePriority = "high";
  } else if (outcome === "disconnected") {
    nudgeMessage = `AI call disconnected before completion. Follow up manually.`;
    nudgePriority = "medium";
  } else if (outcome === "voicemail") {
    nudgeMessage = `AI call reached voicemail. Consider sending a follow-up text.`;
    nudgePriority = "low";
  }

  if (nudgeMessage) {
    try {
      const lead = leadId && Types.ObjectId.isValid(leadId)
        ? await Lead.findById(leadId).lean() as any
        : null;

      // Duplicate nudge prevention: skip if an unread nudge already exists for this lead
      const existingNudge = leadId && Types.ObjectId.isValid(leadId)
        ? await FollowUpNudge.findOne({ userEmail: userEmail.toLowerCase(), leadId: new Types.ObjectId(leadId), read: { $ne: true } }).lean()
        : null;

      if (!existingNudge) {
        await FollowUpNudge.create({
          userEmail: userEmail.toLowerCase(),
          leadId: leadId && Types.ObjectId.isValid(leadId) ? new Types.ObjectId(leadId) : undefined,
          leadName: lead ? `${lead["First Name"] || ""} ${lead["Last Name"] || ""}`.trim() : "",
          message: nudgeMessage,
          priority: nudgePriority,
        });
      }
    } catch (err: any) {
      console.error("[ai-result] FollowUpNudge create error:", err?.message);
    }
  }

  return res.status(200).json({
    ok: true,
    outcome,
    bookingId: booking ? String((booking as any)._id) : undefined,
  });
}
