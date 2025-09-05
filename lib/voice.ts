// lib/voice.ts
import twilio from "twilio";
import { getUserByEmail } from "@/models/User";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken  = process.env.TWILIO_AUTH_TOKEN!;
export const twilioClient = twilio(accountSid, authToken);

// --- Small helpers -----------------------------------------------------------
export function toE164(raw: string | undefined | null): string {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  return s.startsWith("+") ? s : `+${s}`;
}

// Cache to avoid Twilio API spam
const cache = new Map<string, { ok: boolean; at: number }>();
const TTL = 15 * 60 * 1000; // 15 minutes

export async function verifyOwnedVoiceNumber(num: string): Promise<boolean> {
  if (!num) return false;
  const key = `own:${num}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.ok;

  const list = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: num, limit: 1 });
  const ok = !!list.length && !!(list[0].capabilities?.voice ?? true); // most Twilio numbers are voice-capable
  cache.set(key, { ok, at: Date.now() });
  return ok;
}

/**
 * Resolve the caller ID to use for a voice call.
 * Priority:
 *  1) requested (from UI)
 *  2) user's default voice number (if you have it)
 *  3) first number on the user's account (User.numbers[0].phoneNumber)
 *  4) env TWILIO_CALLER_ID (as a final fallback)
 */
export async function resolveFromNumber(opts: {
  requested?: string | null;
  userEmail: string;
}): Promise<string> {
  const candidates: string[] = [];
  if (opts.requested) candidates.push(toE164(opts.requested));

  // Pull from your DB
  const user = await getUserByEmail(opts.userEmail);
  const defaultFrom =
    (user as any)?.defaultVoiceNumber ||
    (user as any)?.defaultFromNumber ||
    null;
  if (defaultFrom) candidates.push(toE164(defaultFrom));

  const anyFrom = (user as any)?.numbers?.[0]?.phoneNumber || null;
  if (anyFrom) candidates.push(toE164(anyFrom));

  // Last resort: env (keeps prod stable during rollout)
  if (process.env.TWILIO_CALLER_ID) candidates.push(toE164(process.env.TWILIO_CALLER_ID));

  // Dedup & verify ownership
  const seen = new Set<string>();
  for (const c of candidates.map(toE164)) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    if (await verifyOwnedVoiceNumber(c)) return c;
  }

  throw new Error("No valid caller ID for this user. Add a voice-capable Twilio number to the account.");
}
