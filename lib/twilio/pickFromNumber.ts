import User from "@/models/User";
import mongooseConnect from "@/lib/mongooseConnect";

/**
 * Returns the user's primary phone number from DB.
 * Priority:
 *   1. Number matching defaultSmsNumberId (by _id or sid)
 *   2. First number auto-set as primary (saved to DB once, never overwritten)
 *   3. TWILIO_DEFAULT_FROM env fallback
 *
 * Never reads from Twilio API — only from DB.
 */
export async function pickFromNumberForUser(email: string): Promise<string | null> {
  await mongooseConnect();
  const user = await User.findOne({ email: email.toLowerCase() })
    .select("numbers defaultSmsNumberId")
    .lean<any>();

  const nums: any[] = user?.numbers || [];
  if (!nums.length) return process.env.TWILIO_DEFAULT_FROM || null;

  const primaryId = user?.defaultSmsNumberId;

  if (primaryId) {
    const primary = nums.find(
      (n: any) => String(n._id) === primaryId || n.sid === primaryId
    );
    if (primary?.phoneNumber) return primary.phoneNumber;
  }

  // No primary set — auto-set the first number once (only if still unset in DB)
  const first = nums[0];
  const firstId = String(first._id) || first.sid;
  try {
    await User.updateOne(
      {
        email: email.toLowerCase(),
        $or: [{ defaultSmsNumberId: null }, { defaultSmsNumberId: { $exists: false } }, { defaultSmsNumberId: "" }],
      },
      { $set: { defaultSmsNumberId: firstId } }
    );
  } catch {
    // best-effort; never block the call
  }

  return first.phoneNumber || process.env.TWILIO_DEFAULT_FROM || null;
}
