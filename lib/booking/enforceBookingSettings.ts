import { DateTime } from "luxon";

type WorkingHours = { [day: string]: { start: string; end: string } };

export type BookingSettings = {
  timezone?: string;
  slotLength?: number;
  bufferTime?: number;
  workingHours?: WorkingHours;
  maxPerDay?: number;
};

export type EnforcementResult = {
  ok: boolean;
  reason?:
    | "missing_settings"
    | "outside_working_hours"
    | "invalid_step"
    | "busy"
    | "maxed"
    | "invalid";
  suggestions?: string[];
};

function normalizeWeekdayKey(dt: DateTime) {
  const long = dt.toFormat("cccc"); // Monday
  const short = dt.toFormat("ccc"); // Mon
  return { long, short };
}

function parseHHMM(hhmm: string): { hour: number; minute: number } | null {
  const m = String(hhmm || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function getDaySchedule(workingHours: WorkingHours | undefined, dtAgent: DateTime) {
  if (!workingHours) return null;
  const { long, short } = normalizeWeekdayKey(dtAgent);
  return workingHours[long] || workingHours[short] || null;
}

function isWithinWorkingHours(
  dtAgentStart: DateTime,
  dtAgentEnd: DateTime,
  workingHours: WorkingHours | undefined,
) {
  const sched = getDaySchedule(workingHours, dtAgentStart);
  if (!sched) return { ok: false as const, reason: "outside_working_hours" as const };
  const s = parseHHMM(sched.start);
  const e = parseHHMM(sched.end);
  if (!s || !e) return { ok: false as const, reason: "outside_working_hours" as const };

  const dayStart = dtAgentStart.set({ hour: s.hour, minute: s.minute, second: 0, millisecond: 0 });
  const dayEnd = dtAgentStart.set({ hour: e.hour, minute: e.minute, second: 0, millisecond: 0 });

  if (dtAgentStart < dayStart || dtAgentEnd > dayEnd) {
    return { ok: false as const, reason: "outside_working_hours" as const, dayStart, dayEnd };
  }
  return { ok: true as const, dayStart, dayEnd };
}

function isValidStep(
  dtAgentStart: DateTime,
  workingHours: WorkingHours | undefined,
  slotLengthMin: number,
  bufferMin: number,
) {
  const sched = getDaySchedule(workingHours, dtAgentStart);
  if (!sched) return { ok: false as const };
  const s = parseHHMM(sched.start);
  if (!s) return { ok: false as const };

  const dayStart = dtAgentStart.set({ hour: s.hour, minute: s.minute, second: 0, millisecond: 0 });
  const stepMin = Math.max(1, Number(slotLengthMin || 30) + Number(bufferMin || 0));
  const diffMin = Math.round(dtAgentStart.diff(dayStart, "minutes").minutes);
  return { ok: diffMin >= 0 && diffMin % stepMin === 0 };
}

async function getBusyBlocks(
  calendar: any,
  calendarId: string,
  timeMinISO: string,
  timeMaxISO: string,
  timeZone: string,
) {
  const resp = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      timeZone,
      items: [{ id: calendarId }],
    },
  });
  return (resp?.data?.calendars?.[calendarId]?.busy || []) as { start?: string; end?: string }[];
}

function overlapsBusy(
  candidateStart: DateTime,
  candidateEnd: DateTime,
  busy: { start?: string; end?: string }[],
  bufferMin: number,
) {
  const start = candidateStart.minus({ minutes: Math.max(0, bufferMin || 0) });
  const end = candidateEnd.plus({ minutes: Math.max(0, bufferMin || 0) });

  return busy.some((b) => {
    const bStart = DateTime.fromISO(String(b.start || ""));
    const bEnd = DateTime.fromISO(String(b.end || ""));
    if (!bStart.isValid || !bEnd.isValid) return false;
    return start < bEnd && end > bStart;
  });
}

async function countEventsForAgentDay(
  calendar: any,
  calendarId: string,
  dayStartAgent: DateTime,
  dayEndAgent: DateTime,
) {
  const resp = await calendar.events.list({
    calendarId,
    timeMin: dayStartAgent.toUTC().toISO(),
    timeMax: dayEndAgent.toUTC().toISO(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });
  const items = (resp?.data?.items || []) as any[];
  const valid = items.filter((ev) => ev && ev.status !== "cancelled");
  const timed = valid.filter((ev) => !!(ev?.start?.dateTime || ev?.end?.dateTime));
  return timed.length;
}

function formatSuggestionISO(dtAgent: DateTime, outputZone: string) {
  if (outputZone === "UTC") return dtAgent.toUTC().toISO();
  return dtAgent.setZone(outputZone).toISO();
}

async function buildSuggestions(
  calendar: any,
  calendarId: string,
  settings: BookingSettings,
  requestedStartAgent: DateTime,
  durationMinutes: number,
  outputZone: string,
  limit: number,
) {
  const tzAgent: string =
    settings.timezone || requestedStartAgent.zoneName || "UTC";
  const workingHours = settings.workingHours || {};
  const slotLengthMin = Number(settings.slotLength || 30);
  const bufferMin = Number(settings.bufferTime || 0);
  const maxPerDay = Number(settings.maxPerDay || 0);

  const suggestions: string[] = [];
  const daysToScan = 7;

  for (let i = 0; i < daysToScan && suggestions.length < limit; i++) {
    const day = requestedStartAgent.plus({ days: i }).setZone(tzAgent).startOf("day");
    const sched = getDaySchedule(workingHours, day);
    if (!sched) continue;
    const s = parseHHMM(sched.start);
    const e = parseHHMM(sched.end);
    if (!s || !e) continue;

    const dayStart = day.set({ hour: s.hour, minute: s.minute, second: 0, millisecond: 0 });
    const dayEnd = day.set({ hour: e.hour, minute: e.minute, second: 0, millisecond: 0 });

    if (maxPerDay > 0) {
      const existingCount = await countEventsForAgentDay(calendar, calendarId, dayStart, dayEnd);
      if (existingCount >= maxPerDay) continue;
    }

    const busy = await getBusyBlocks(
      calendar,
      calendarId,
      dayStart.toUTC().toISO()!,
      dayEnd.toUTC().toISO()!,
      tzAgent,
    );

    const stepMin = Math.max(1, slotLengthMin + bufferMin);
    let cur = dayStart;

    if (i === 0 && requestedStartAgent > dayStart) {
      const diffMin = Math.max(0, Math.round(requestedStartAgent.diff(dayStart, "minutes").minutes));
      const snapped = diffMin - (diffMin % stepMin);
      cur = dayStart.plus({ minutes: snapped });
      if (cur < requestedStartAgent) cur = cur.plus({ minutes: stepMin });
    }

    while (cur < dayEnd && suggestions.length < limit) {
      const end = cur.plus({ minutes: durationMinutes });
      if (end > dayEnd) break;
      const within = isWithinWorkingHours(cur, end, workingHours);
      if (!within.ok) break;
      const stepOk = isValidStep(cur, workingHours, slotLengthMin, bufferMin);
      if (stepOk.ok && !overlapsBusy(cur, end, busy, bufferMin)) {
        const iso = formatSuggestionISO(cur, outputZone);
        if (iso) suggestions.push(iso);
      }
      cur = cur.plus({ minutes: stepMin });
    }
  }

  return suggestions;
}

export async function enforceBookingSettings(params: {
  calendar: any;
  calendarId: string;
  bookingSettings: BookingSettings | undefined | null;
  requestedStart: DateTime;
  durationMinutes: number;
  outputZone: string; // "UTC" or IANA
  suggestionLimit?: number;
}): Promise<EnforcementResult> {
  const {
    calendar,
    calendarId,
    bookingSettings,
    requestedStart,
    durationMinutes,
    outputZone,
    suggestionLimit = 3,
  } = params;

  if (!bookingSettings) return { ok: false, reason: "missing_settings", suggestions: [] };

  const tzAgent = bookingSettings.timezone || "America/Los_Angeles";
  const slotLengthMin = Number(bookingSettings.slotLength || 30);
  const bufferMin = Number(bookingSettings.bufferTime || 0);
  const maxPerDay = Number(bookingSettings.maxPerDay || 0);
  const workingHours = bookingSettings.workingHours || {};

  const startAgent = requestedStart.setZone(tzAgent).set({ second: 0, millisecond: 0 });
  const endAgent = startAgent.plus({ minutes: Math.max(1, durationMinutes || 30) });

  const within = isWithinWorkingHours(startAgent, endAgent, workingHours);
  if (!within.ok) {
    return {
      ok: false,
      reason: "outside_working_hours",
      suggestions: await buildSuggestions(calendar, calendarId, bookingSettings, startAgent, durationMinutes, outputZone, suggestionLimit),
    };
  }

  const stepOk = isValidStep(startAgent, workingHours, slotLengthMin, bufferMin);
  if (!stepOk.ok) {
    return {
      ok: false,
      reason: "invalid_step",
      suggestions: await buildSuggestions(calendar, calendarId, bookingSettings, startAgent, durationMinutes, outputZone, suggestionLimit),
    };
  }

  if (maxPerDay > 0 && (within as any).dayStart && (within as any).dayEnd) {
    const existingCount = await countEventsForAgentDay(calendar, calendarId, (within as any).dayStart, (within as any).dayEnd);
    if (existingCount >= maxPerDay) {
      return {
        ok: false,
        reason: "maxed",
        suggestions: await buildSuggestions(calendar, calendarId, bookingSettings, startAgent.plus({ days: 1 }).startOf("day"), durationMinutes, outputZone, suggestionLimit),
      };
    }
  }

  const busy = await getBusyBlocks(
    calendar,
    calendarId,
    startAgent.minus({ minutes: Math.max(0, bufferMin) }).toUTC().toISO()!,
    endAgent.plus({ minutes: Math.max(0, bufferMin) }).toUTC().toISO()!,
    tzAgent,
  );
  if (overlapsBusy(startAgent, endAgent, busy, bufferMin)) {
    return {
      ok: false,
      reason: "busy",
      suggestions: await buildSuggestions(calendar, calendarId, bookingSettings, startAgent, durationMinutes, outputZone, suggestionLimit),
    };
  }

  return { ok: true };
}

