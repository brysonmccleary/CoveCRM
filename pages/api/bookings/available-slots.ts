// pages/api/bookings/available-slots.ts
// Token-auth GET — return next 3 available appointment slots for a user
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Booking from "@/models/Booking";

const COVECRM_API_SECRET = process.env.COVECRM_API_SECRET || "";

function pad(n: number) { return String(n).padStart(2, "0"); }

function parseHHMM(s: string): { h: number; m: number } {
  const [h = "9", m = "0"] = (s || "09:00").split(":");
  return { h: parseInt(h, 10), m: parseInt(m, 10) };
}

/** Get local date string "YYYY-MM-DD" in a given timezone */
function localDateString(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Get local day-of-week 0=Sun..6=Sat in a given timezone */
function localDayOfWeek(date: Date, tz: string): number {
  try {
    const dayName = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
    }).format(date);
    return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].indexOf(dayName);
  } catch {
    return date.getDay();
  }
}

/** Format a UTC date for display in the user's timezone */
function formatSlot(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Given a local date string ("YYYY-MM-DD") and local HH:MM, compute the UTC Date
 * by finding the offset for that specific timezone/date combo.
 */
function localToUtc(dateStr: string, h: number, m: number, tz: string): Date {
  // Use the Intl API to determine the UTC offset for the given local time
  const localIso = `${dateStr}T${pad(h)}:${pad(m)}:00`;
  // Create a Date assuming UTC and then adjust for timezone offset
  const guessUtc = new Date(localIso + "Z");
  // Get what Intl thinks the local time is at this UTC instant
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(guessUtc);
  const lp: Record<string, number> = {};
  for (const p of localParts) lp[p.type] = parseInt(p.value, 10);
  const diffMs = guessUtc.getTime() - new Date(
    `${lp.year}-${pad(lp.month)}-${pad(lp.day)}T${pad(lp.hour === 24 ? 0 : lp.hour)}:${pad(lp.minute)}:${pad(lp.second)}Z`
  ).getTime();
  return new Date(guessUtc.getTime() + diffMs);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers["x-api-secret"] || req.headers["authorization"];
  const token = Array.isArray(authHeader) ? authHeader[0] : authHeader || "";
  const bare = token.replace(/^Bearer\s+/i, "");
  if (!COVECRM_API_SECRET || bare !== COVECRM_API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { userEmail } = req.query as { userEmail?: string };
  if (!userEmail) return res.status(400).json({ error: "userEmail is required" });

  await mongooseConnect();

  const user = await User.findOne({ email: userEmail.toLowerCase() }).lean() as any;
  if (!user) return res.status(404).json({ error: "User not found" });

  const tz = user.bookingTimezone || user.timezone || "America/Phoenix";
  const slotLength = user.slotLengthMinutes || 30;
  const startStr = user.workingHoursStart || "09:00";
  const endStr = user.workingHoursEnd || "17:00";
  const { h: startH, m: startM } = parseHHMM(startStr);
  const { h: endH } = parseHHMM(endStr);

  const slots: { label: string; iso: string }[] = [];
  const now = new Date();

  // Build candidate slots first (up to 30 so we have room after collision filtering)
  const candidates: { label: string; iso: string; utc: Date }[] = [];
  for (let day = 0; day < 14 && candidates.length < 30; day++) {
    const candidate = new Date(now.getTime() + day * 86400000);
    const dayOfWeek = localDayOfWeek(candidate, tz);

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dateStr = localDateString(candidate, tz);
    let h = startH;
    let m = startM;

    while (h < endH) {
      const slotUtc = localToUtc(dateStr, h, m, tz);

      // Must be in the future (at least 15 min from now)
      if (slotUtc.getTime() > now.getTime() + 15 * 60 * 1000) {
        candidates.push({ label: formatSlot(slotUtc, tz), iso: slotUtc.toISOString(), utc: slotUtc });
      }

      m += slotLength;
      while (m >= 60) { m -= 60; h++; }
    }
  }

  // Query existing booked appointments in the window ±30 min around each candidate
  const windowMs = 30 * 60 * 1000;
  const windowStart = candidates.length > 0 ? new Date(candidates[0].utc.getTime() - windowMs) : now;
  const windowEnd = candidates.length > 0 ? new Date(candidates[candidates.length - 1].utc.getTime() + windowMs) : now;

  let bookedTimes: Date[] = [];
  try {
    // Check Lead.appointmentTime
    const bookedLeads = await Lead.find({
      userEmail: userEmail.toLowerCase(),
      appointmentTime: { $gte: windowStart, $lte: windowEnd },
    }).select("appointmentTime").lean() as any[];
    bookedTimes = bookedLeads.map((l: any) => new Date(l.appointmentTime)).filter((d) => !isNaN(d.getTime()));
  } catch {
    // non-blocking — if query fails, show all slots
  }

  try {
    // Also check Booking model for agent-level bookings
    const bookings = await (Booking as any).find({
      agentEmail: userEmail.toLowerCase(),
      date: { $gte: windowStart, $lte: windowEnd },
      noShow: { $ne: true },
    }).select("date").lean() as any[];
    const bookingTimes = bookings.map((b: any) => new Date(b.date)).filter((d: Date) => !isNaN(d.getTime()));
    bookedTimes = [...bookedTimes, ...bookingTimes];
  } catch {
    // non-blocking
  }

  // Filter out candidates that collide with an existing appointment (±30 min)
  for (const c of candidates) {
    if (slots.length >= 3) break;
    const hasCollision = bookedTimes.some(
      (bt) => Math.abs(bt.getTime() - c.utc.getTime()) < windowMs
    );
    if (!hasCollision) {
      slots.push({ label: c.label, iso: c.iso });
    }
  }

  return res.status(200).json({ slots, timezone: tz });
}
