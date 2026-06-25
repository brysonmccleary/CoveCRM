// lib/billing/requireAI.ts
import type { HydratedDocument } from "mongoose";
import User from "@/models/User";
import connectToDatabase from "@/lib/mongodb";
import { isAdmin } from "@/lib/featureFlags";

type GateOk = { ok: true; user?: HydratedDocument<any> };
type GateFail = { ok: false; status: 404 | 403; error: string; reason?: string };

type RequireAIOptions = {
  // If you have owner/admin bypasses, enable this and adapt isOwner logic below.
  allowOwnerBypass?: boolean;
  // If true, includes the loaded user object in the ok response.
  includeUser?: boolean;
};

export async function requireAI(email: string, opts: RequireAIOptions = {}) : Promise<GateOk | GateFail> {
  if (!email) return { ok: false, status: 404, error: "User not found" };

  await connectToDatabase();

  const user = await User.findOne({ email });
  if (!user) return { ok: false, status: 404, error: "User not found" };
  const userEmail = String((user as any).email || email || "").toLowerCase();

  if (isAdmin(userEmail)) {
    return { ok: true, user: opts.includeUser ? user : undefined };
  }

  if ((user as any).hasAI === true) {
    return { ok: true, user: opts.includeUser ? user : undefined };
  }

  return {
    ok: false,
    status: 403,
    reason: "AI features require the AI plan. Go to Settings → Billing & Usage to upgrade for $50/month.",
    error: "AI features require the AI plan. Go to Settings → Billing & Usage to upgrade for $50/month.",
  };
}
