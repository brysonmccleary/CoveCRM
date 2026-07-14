// lib/ai/assistant/scheduleAppointmentTool.ts
// Assistant tool: schedule a NEW appointment for the requesting agent's own
// lead. Rescheduling an existing appointment is intentionally not supported
// here — there's no reliable way today to find/move an existing calendar
// event for a lead, so a second booking would create a duplicate rather than
// moving the first (flagged, not built, per the read-only diagnosis).
import { scheduleAppointment } from "@/lib/calendar/scheduleAppointment";

export const SCHEDULE_APPOINTMENT_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "schedule_appointment",
    description:
      "Schedule a NEW calendar appointment for one of the requesting agent's own leads (does not support moving/canceling an existing appointment). Requires a specific leadId — typically from a prior query_leads call. You are told the current date/time in the system prompt; compute relative dates yourself (e.g. \"next Tuesday at 2pm\") before calling this tool. startISO and endISO must be full ISO 8601 datetimes including a UTC offset.",
    parameters: {
      type: "object",
      properties: {
        leadId: { type: "string", description: "The lead's id, typically from a prior query_leads result." },
        startISO: { type: "string", description: "Appointment start time, ISO 8601 with a UTC offset, e.g. 2026-07-14T14:00:00-07:00." },
        endISO: { type: "string", description: "Appointment end time, ISO 8601 with a UTC offset. Default to 30 minutes after start if the user didn't specify a duration." },
        title: { type: "string", description: "Optional calendar event title. Defaults to \"Call with <lead name>\"." },
        description: { type: "string", description: "Optional calendar event description." },
      },
      required: ["leadId", "startISO", "endISO"],
      additionalProperties: false,
    },
  },
};

export type ScheduleAppointmentArgs = {
  leadId: string;
  startISO: string;
  endISO: string;
  title?: string;
  description?: string;
};

export async function runScheduleAppointmentTool(userEmail: string, args: ScheduleAppointmentArgs) {
  const email = String(userEmail || "").toLowerCase();
  if (!email) return { scheduled: false, reason: "Unauthorized" };
  if (!args?.leadId || !args?.startISO || !args?.endISO) {
    return { scheduled: false, reason: "leadId, startISO, and endISO are required" };
  }

  const result = await scheduleAppointment({
    userEmail: email,
    leadId: args.leadId,
    startISO: args.startISO,
    endISO: args.endISO,
    title: args.title,
    description: args.description,
  });

  if (!result.ok) {
    return { scheduled: false, reason: result.error };
  }
  return { scheduled: true, eventId: result.eventId, eventUrl: result.eventUrl };
}
