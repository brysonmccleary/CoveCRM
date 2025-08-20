import User from "@/models/User";

/** Pick first saved user number; fall back to env default if present. */
export async function pickFromNumberForUser(email: string): Promise<string | null> {
  const user = await User.findOne({ email: email.toLowerCase() }).lean<any>();
  const fromUser = user?.numbers?.[0]?.phoneNumber || null;
  const fallback = process.env.TWILIO_DEFAULT_FROM || null;
  return fromUser || fallback;
}
