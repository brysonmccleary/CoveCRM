// lib/billing/checkCallingAllowed.ts
// Server-side guard: returns whether a user is allowed to place outbound calls.
// Self-billed users always pass. Platform-billed users are blocked if callingBlocked is set.
// Grace period: if hasEverPaid && pastDueSince, allow for 3 days then block.
import User from "@/models/User";
import mongooseConnect from "@/lib/mongooseConnect";

export interface CallingCheck {
  allowed: boolean;
  reason?: string;
}

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const BLOCKED_MESSAGE =
  "Your subscription payment failed. Please update billing to continue calling.";

export async function checkCallingAllowed(email: string): Promise<CallingCheck> {
  await mongooseConnect();
  const user = await User.findOne({ email: email.toLowerCase() })
    .select("billingMode callingBlocked hasEverPaid pastDueSince")
    .lean<any>();

  if (!user) return { allowed: false, reason: "User not found" };

  // Self-billed users manage their own Twilio — no platform payment check.
  if ((user as any).billingMode === "self") return { allowed: true };

  // Already explicitly blocked.
  if ((user as any).callingBlocked) {
    return { allowed: false, reason: BLOCKED_MESSAGE };
  }

  // Grace period check: hasEverPaid + pastDueSince set means renewal failed.
  const pastDueSince: Date | null = (user as any).pastDueSince ?? null;
  if ((user as any).hasEverPaid && pastDueSince) {
    const elapsed = Date.now() - new Date(pastDueSince).getTime();
    if (elapsed <= GRACE_PERIOD_MS) {
      // Within grace period — allow, no DB write needed.
      return { allowed: true };
    }
    // Grace period expired — promote to callingBlocked.
    await User.updateOne(
      { email: email.toLowerCase() },
      { $set: { callingBlocked: true } }
    );
    return { allowed: false, reason: BLOCKED_MESSAGE };
  }

  return { allowed: true };
}
