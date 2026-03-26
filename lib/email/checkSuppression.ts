// lib/email/checkSuppression.ts
import EmailSuppression from "@/models/EmailSuppression";

/**
 * Returns true if the recipient email is suppressed for this sender (userEmail).
 * Caller must have already called mongooseConnect().
 */
export async function checkSuppression(
  userEmail: string,
  toEmail: string
): Promise<boolean> {
  const hit = await EmailSuppression.findOne({
    userEmail: userEmail.toLowerCase().trim(),
    email: toEmail.toLowerCase().trim(),
  })
    .select("_id")
    .lean();
  return !!hit;
}
