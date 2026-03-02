import type { HydratedDocument } from "mongoose";
import User from "@/models/User";
import connectToDatabase from "@/lib/mongodb";

type GateOk = { ok: true; user?: HydratedDocument<any> };
type GateFail = { ok: false; status: 404 | 403; error: string };

type RequireAIOptions = {
  // If you have owner/admin bypasses, enable this and adapt isOwner logic below.
  allowOwnerBypass?: boolean;
  // If true, includes the loaded user object in the ok response.
  includeUser?: boolean;
};

function isOwnerAccount(user: any) {
  // 🔒 ADAPT THIS to your actual schema (role/isOwner/isAdmin/email allowlist/etc).
  // Keep default as false so we don't accidentally bypass.
  return Boolean(user?.role === "owner" || user?.isOwner === true);
}

export async function requireAI(email: string, opts: RequireAIOptions = {}) : Promise<GateOk | GateFail> {
  if (!email) return { ok: false, status: 404, error: "User not found" };

  await connectToDatabase();

  const user = await User.findOne({ email });
  if (!user) return { ok: false, status: 404, error: "User not found" };

  if (opts.allowOwnerBypass && isOwnerAccount(user)) {
    return { ok: true, user: opts.includeUser ? user : undefined };
  }

  if (!user.hasAI) return { ok: false, status: 403, error: "AI upgrade required" };

  return { ok: true, user: opts.includeUser ? user : undefined };
}
