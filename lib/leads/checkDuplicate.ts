// lib/leads/checkDuplicate.ts
// Check if a lead with the same phone or email already exists for this user
import Lead from "@/lib/mongo/leads";

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  matchType: "phone" | "email" | "both" | null;
  existingLeadId?: string;
  existingName?: string;
}

export async function checkDuplicate(
  userEmail: string,
  phone?: string,
  email?: string,
  excludeLeadId?: string
): Promise<DuplicateCheckResult> {
  const normalizedPhone = phone?.replace(/\D+/g, "").slice(-10) || "";
  const normalizedEmail = (email || "").toLowerCase().trim();

  if (!normalizedPhone && !normalizedEmail) {
    return { isDuplicate: false, matchType: null };
  }

  const orConditions: any[] = [];
  if (normalizedPhone) {
    orConditions.push({ phoneLast10: normalizedPhone });
  }
  if (normalizedEmail) {
    orConditions.push({ email: normalizedEmail });
  }

  const query: any = {
    userEmail,
    $or: orConditions,
  };

  if (excludeLeadId) {
    query._id = { $ne: excludeLeadId };
  }

  const existing = await Lead.findOne(query)
    .select("_id First\\ Name Last\\ Name phoneLast10 email")
    .lean();

  if (!existing) return { isDuplicate: false, matchType: null };

  const phoneMatch = normalizedPhone && (existing as any).phoneLast10 === normalizedPhone;
  const emailMatch = normalizedEmail && (existing as any).email === normalizedEmail;

  let matchType: "phone" | "email" | "both" = "phone";
  if (phoneMatch && emailMatch) matchType = "both";
  else if (emailMatch) matchType = "email";

  const firstName = (existing as any)["First Name"] || "";
  const lastName = (existing as any)["Last Name"] || "";

  return {
    isDuplicate: true,
    matchType,
    existingLeadId: String((existing as any)._id),
    existingName: `${firstName} ${lastName}`.trim() || "Unknown",
  };
}
