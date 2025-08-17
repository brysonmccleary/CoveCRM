// lib/getUserByPhoneNumber.ts
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

/** Normalize to E.164 (+1XXXXXXXXXX for US/CA) */
export function normalizeE164(p: string): string {
  if (!p) return "";
  const digits = String(p).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return p.startsWith("+") ? p : `+${digits}`;
}

/** Last 10 digits helper for loose matching */
export function last10(p: string): string {
  const digits = String(p).replace(/\D/g, "");
  return digits.slice(-10);
}

/**
 * Look up the user who owns a specific Twilio number.
 * Tries exact E.164 first, then common variants, then a last-10 fallback.
 */
export async function getUserByPhoneNumber(phoneNumber: string) {
  await dbConnect();

  const e164 = normalizeE164(phoneNumber);
  const l10 = last10(e164);

  // 1) Exact E.164 (preferred)
  let user = await User.findOne({ "numbers.phoneNumber": e164 });
  if (user) return user;

  // 2) Try a few common variants / legacy saved formats
  user =
    (await User.findOne({ "numbers.phoneNumber": phoneNumber })) ||
    (await User.findOne({ "numbers.phoneNumber": e164.replace(/^\+1/, "") })) ||
    (await User.findOne({ "numbers.phoneNumber": `+1${l10}` })) ||
    (await User.findOne({ "numbers.phoneNumber": l10 }));

  if (user) return user;

  // 3) Last-10 fallback (regex suffix match)
  user = await User.findOne({
    "numbers.phoneNumber": { $regex: new RegExp(`${l10}$`) },
  });

  return user || null;
}

/*
💡 Recommended indexes (add in your User schema to make lookups blazing fast):

// In models/User.ts
UserSchema.index({ email: 1 }, { name: "user_email_idx" });
UserSchema.index({ "numbers.phoneNumber": 1 }, { name: "user_numbers_phone_idx" });

Since everything in your app keys off the user doc (and you already use user.email everywhere),
this function simply returns the User; downstream code should continue to read/write by user.email.
*/
