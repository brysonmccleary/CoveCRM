import { Types } from "mongoose";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import Booking from "@/models/Booking";
import User from "@/models/User";
import FollowUpNudge from "@/models/FollowUpNudge";
import DripCampaign from "@/models/DripCampaign";
import DripEnrollment from "@/models/DripEnrollment";
import AICallSession from "@/models/AICallSession";
import { google } from "googleapis";
import { resolveLeadIds } from "./resolveLeadIds";
import type { QueryLeadsArgs } from "./queryLeadsTool";
import { createBulkTextConfirmation, verifyBulkTextConfirmation } from "./bulkTextConfirmation";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const FILTERS = {
  leadIds: { type: "array", items: { type: "string" } }, search: { type: "string" }, folderName: { type: "string" },
  status: { type: "string" }, statusNot: { type: "string" }, state: { type: "string" }, leadType: { type: "string" },
  city: { type: "string" }, zip: { type: "string" }, source: { type: "string" }, notContactedInDays: { type: "number" },
} as const;

export const CREATE_REMINDER_TOOL_DEF = { type: "function" as const, function: {
  name: "create_reminder", description: "Create an in-app follow-up reminder for a specific lead or matching leads. Convert casual times like tomorrow afternoon into dueISO before calling.",
  parameters: { type: "object", properties: { ...FILTERS, message: { type: "string" }, dueISO: { type: "string" }, priority: { type: "string", enum: ["high", "medium", "low"] } }, required: ["message", "dueISO"], additionalProperties: false },
} };

export async function runCreateReminderTool(userEmail: string, args: QueryLeadsArgs & any) {
  const email = String(userEmail || "").toLowerCase();
  const dueAt = new Date(args.dueISO);
  if (!email || !args.message?.trim() || Number.isNaN(dueAt.getTime())) return { ok: false, error: "Valid message and dueISO are required" };
  const ids = await resolveLeadIds(email, args);
  if (!ids.length) return { ok: true, created: 0, reason: "no_matching_leads" };
  const leads = await (Lead as any).find({ _id: { $in: ids }, userEmail: email }).select({ "First Name": 1, "Last Name": 1 }).lean();
  const docs = leads.map((lead: any) => ({ userEmail: email, leadId: lead._id, leadName: [lead["First Name"], lead["Last Name"]].filter(Boolean).join(" "), message: args.message.trim(), priority: args.priority || "medium", dueAt, generatedAt: new Date() }));
  await (FollowUpNudge as any).insertMany(docs);
  return { ok: true, created: docs.length, dueAt };
}

export const MANAGE_DRIP_TOOL_DEF = { type: "function" as const, function: {
  name: "manage_drip_enrollment", description: "List SMS drip campaigns, enroll matching leads in a campaign, or pause/resume/cancel their enrollment. Enrollment previews first because it can send automated texts; call again with confirm true only after approval.",
  parameters: { type: "object", properties: { ...FILTERS, action: { type: "string", enum: ["list", "enroll", "pause", "resume", "cancel"] }, campaignName: { type: "string" }, confirm: { type: "boolean" }, confirmationToken: { type: "string" } }, required: ["action"], additionalProperties: false },
} };

export async function runManageDripTool(userEmail: string, args: QueryLeadsArgs & any) {
  const email = String(userEmail || "").toLowerCase();
  const scope = { type: "sms", $or: [{ user: email }, { userEmail: email }, { isGlobal: true }] };
  if (args.action === "list") {
    const campaigns = await (DripCampaign as any).find({ ...scope, isActive: true }).select({ name: 1, key: 1 }).lean();
    return { ok: true, campaigns: campaigns.map((c: any) => ({ id: String(c._id), name: c.name, key: c.key || null })) };
  }
  const campaignName = String(args.campaignName || "").trim();
  const campaign = await (DripCampaign as any).findOne({ ...scope, name: new RegExp(`^${campaignName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).lean();
  if (!campaign) return { ok: false, error: "Campaign not found" };
  const ids = (await resolveLeadIds(email, args)).filter((id) => Types.ObjectId.isValid(id));
  if (!ids.length) return { ok: true, matched: 0 };
  if (args.action === "enroll" && !args.confirm) return { ok: true, preview: true, matched: ids.length, campaignName: campaign.name, confirmationToken: createBulkTextConfirmation({ userEmail: email, message: `enroll_drip:${String(campaign._id)}`, leadIds: ids }), note: "Nothing enrolled. Ask for confirmation." };
  if (args.action === "enroll") {
    const confirmation = verifyBulkTextConfirmation(String(args.confirmationToken || ""), email);
    if (!confirmation || confirmation.message !== `enroll_drip:${String(campaign._id)}`) return { ok: false, error: "A valid enrollment preview confirmation is required" };
    const ops = confirmation.leadIds.map((leadId) => ({ updateOne: { filter: { leadId, campaignId: campaign._id, userEmail: email, status: { $in: ["active", "paused"] } }, update: { $setOnInsert: { leadId, campaignId: campaign._id, userEmail: email, status: "active", cursorStep: 0, nextSendAt: new Date(), source: "manual-lead", schedulingVersion: 1 } }, upsert: true } }));
    await (DripEnrollment as any).bulkWrite(ops);
    return { ok: true, enrolled: confirmation.leadIds.length, campaignName: campaign.name };
  }
  const state = args.action === "pause" ? { status: "paused", paused: true, isPaused: true } : args.action === "resume" ? { status: "active", paused: false, isPaused: false, stopAll: false } : { status: "canceled", active: false, isActive: false, enabled: false, stopAll: true };
  const result = await (DripEnrollment as any).updateMany({ leadId: { $in: ids }, campaignId: campaign._id, userEmail: email }, { $set: state });
  return { ok: true, changed: result.modifiedCount || 0, action: args.action };
}

export const CONTROL_DIAL_SESSION_TOOL_DEF = { type: "function" as const, function: {
  name: "control_dial_session", description: "Show, pause, resume, or stop the current/latest AI dial session.",
  parameters: { type: "object", properties: { action: { type: "string", enum: ["status", "pause", "resume", "stop"] }, sessionId: { type: "string" } }, required: ["action"], additionalProperties: false },
} };

export async function runControlDialSessionTool(userEmail: string, args: any) {
  const email = String(userEmail || "").toLowerCase();
  const filter: any = { userEmail: email, callDirection: { $ne: "inbound" }, scriptKey: { $ne: "kayla_signup" } };
  if (args.sessionId && Types.ObjectId.isValid(args.sessionId)) filter._id = args.sessionId;
  else filter.status = { $in: ["queued", "running", "paused"] };
  const session = await (AICallSession as any).findOne(filter).sort({ createdAt: -1 });
  if (!session) return { ok: false, error: "No matching dial session" };
  if (args.action !== "status") {
    const activeCallSid = String(session.activeCallSid || "");
    const stoppedAt = new Date();
    session.status = args.action === "pause" ? "paused" : args.action === "resume" ? "queued" : "stopped";
    if (args.action === "stop") { session.completedAt = stoppedAt; session.stoppedAt = stoppedAt; session.activeCallSid = null; session.currentCall = null; }
    await session.save();
    if (args.action === "stop") {
      if (activeCallSid) {
        try { const { client } = await getClientForUser(email); await client.calls(activeCallSid).update({ status: "completed" } as any); } catch {}
      }
      if (session.startedAt) {
        try {
          const { trackAiDialerSessionUsage } = await import("@/lib/billing/trackAiDialerSessionUsage");
          await trackAiDialerSessionUsage({ sessionId: String(session._id), userEmail: email, endAt: stoppedAt });
        } catch {}
      }
    }
  }
  return { ok: true, sessionId: String(session._id), status: session.status, total: session.total, completed: session.stats?.completed || 0, currentLead: session.currentCall?.leadName || null };
}

async function calendarFor(email: string) {
  const user: any = await (User as any).findOne({ email });
  const tokens = user?.googleCalendar || user?.googleTokens || user?.googleSheets;
  const refreshToken = tokens?.refreshToken || tokens?.refresh_token;
  if (!refreshToken) return null;
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  auth.setCredentials({ refresh_token: refreshToken, access_token: tokens?.accessToken || tokens?.access_token, expiry_date: tokens?.expiryDate || tokens?.expiry_date });
  return { calendar: google.calendar({ version: "v3", auth }), calendarId: user.calendarId || "primary" };
}

export const MANAGE_APPOINTMENT_TOOL_DEF = { type: "function" as const, function: {
  name: "manage_appointment", description: "List upcoming appointments or reschedule/cancel an existing appointment for a lead. Cancellation previews first and requires confirmation.",
  parameters: { type: "object", properties: { action: { type: "string", enum: ["list", "reschedule", "cancel"] }, ...FILTERS, startISO: { type: "string" }, endISO: { type: "string" }, confirm: { type: "boolean" }, confirmationToken: { type: "string" } }, required: ["action"], additionalProperties: false },
} };

export async function runManageAppointmentTool(userEmail: string, args: QueryLeadsArgs & any) {
  const email = String(userEmail || "").toLowerCase();
  if (args.action === "list") {
    const rows = await (Lead as any).find({ userEmail: email, appointmentTime: { $gte: new Date() } }).select({ "First Name": 1, "Last Name": 1, appointmentTime: 1 }).sort({ appointmentTime: 1 }).limit(50).lean();
    return { ok: true, appointments: rows.map((l: any) => ({ leadId: String(l._id), name: [l["First Name"], l["Last Name"]].filter(Boolean).join(" "), appointmentTime: l.appointmentTime })) };
  }
  const ids = await resolveLeadIds(email, args);
  if (ids.length !== 1) return { ok: false, error: ids.length ? "Please identify one lead" : "Lead not found" };
  const lead: any = await (Lead as any).findOne({ _id: ids[0], userEmail: email });
  if (!lead?.appointmentTime) return { ok: false, error: "No appointment found for that lead" };
  const booking: any = await (Booking as any).findOne({ userEmail: email, leadId: lead._id }).sort({ date: -1 });
  const eventId = booking?.eventId || lead.calendarEventId;
  if (args.action === "cancel" && !args.confirm) return { ok: true, preview: true, appointmentTime: lead.appointmentTime, confirmationToken: createBulkTextConfirmation({ userEmail: email, message: `cancel_appointment:${String(lead._id)}`, leadIds: [String(lead._id)] }), note: "Nothing canceled. Ask for confirmation." };
  const client = eventId ? await calendarFor(email) : null;
  if (args.action === "reschedule") {
    const start = new Date(args.startISO); const end = new Date(args.endISO);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return { ok: false, error: "Valid startISO and endISO are required" };
    if (client && eventId) await client.calendar.events.patch({ calendarId: client.calendarId, eventId, requestBody: { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } } });
    lead.appointmentTime = start; await lead.save();
    if (booking) { booking.date = start; booking.appointmentTime = start; await booking.save(); }
    return { ok: true, rescheduled: true, appointmentTime: start };
  }
  const confirmation = verifyBulkTextConfirmation(String(args.confirmationToken || ""), email);
  if (!confirmation || confirmation.message !== `cancel_appointment:${String(lead._id)}`) return { ok: false, error: "A valid cancellation preview confirmation is required" };
  if (client && eventId) await client.calendar.events.delete({ calendarId: client.calendarId, eventId });
  lead.appointmentTime = undefined; await lead.save();
  if (booking) await booking.deleteOne();
  return { ok: true, canceled: true };
}

export const CRM_REPORT_TOOL_DEF = { type: "function" as const, function: {
  name: "crm_report", description: "Report lead totals, statuses, sales, upcoming appointments, folder counts, and AI dial-session results for the current user.",
  parameters: { type: "object", properties: { days: { type: "number" } }, additionalProperties: false },
} };

export async function runCrmReportTool(userEmail: string, args: any) {
  const email = String(userEmail || "").toLowerCase(); const days = Math.min(3650, Math.max(1, Number(args.days) || 30));
  const since = new Date(Date.now() - days * 86400000); const scope = { userEmail: email, createdAt: { $gte: since } };
  const [total, statuses, folders, appointments, sessions] = await Promise.all([
    (Lead as any).countDocuments(scope), (Lead as any).aggregate([{ $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    (Lead as any).aggregate([{ $match: scope }, { $group: { _id: "$folderId", count: { $sum: 1 } } }]),
    (Lead as any).countDocuments({ userEmail: email, appointmentTime: { $gte: new Date() } }),
    (AICallSession as any).find({ userEmail: email, createdAt: { $gte: since }, callDirection: { $ne: "inbound" } }).select({ stats: 1, total: 1, status: 1 }).lean(),
  ]);
  const folderDocs = await (Folder as any).find({ _id: { $in: folders.map((f: any) => f._id).filter(Boolean) }, userEmail: email }).select({ name: 1 }).lean();
  const names = new Map(folderDocs.map((f: any) => [String(f._id), f.name]));
  return { ok: true, days, totalLeads: total, statuses: Object.fromEntries(statuses.map((s: any) => [s._id || "Unspecified", s.count])), upcomingAppointments: appointments, folders: Object.fromEntries(folders.map((f: any) => [f._id ? names.get(String(f._id)) || "Unknown" : "Unsorted", f.count])), dialSessions: sessions.length, dialedLeads: sessions.reduce((n: number, s: any) => n + Number(s.total || 0), 0), bookedByDialer: sessions.reduce((n: number, s: any) => n + Number(s.stats?.booked || 0), 0) };
}

export const EXPORT_LEADS_TOOL_DEF = { type: "function" as const, function: {
  name: "export_leads", description: "Provide a CSV download link for a named folder or unsorted leads.",
  parameters: { type: "object", properties: { folderName: { type: "string" }, unsorted: { type: "boolean" } }, additionalProperties: false },
} };
export async function runExportLeadsTool(_email: string, args: any) {
  const target = args.unsorted ? "unsorted" : String(args.folderName || "").trim();
  if (!target) return { ok: false, error: "folderName is required" };
  return { ok: true, downloadUrl: `/api/leads/export-csv?folderId=${encodeURIComponent(target)}`, note: "Open this link while signed in to download the CSV." };
}
