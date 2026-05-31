// pages/api/settings/update-email.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import { getPlatformTwilioClient } from "@/lib/twilio/getPlatformClient";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { cascadeEmailUpdateMany } from "@/lib/cascadeEmailUpdate";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = (await getServerSession(
    req,
    res,
    authOptions as any,
  )) as Session | null;

  const currentEmail =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase().trim()
      : "";
  if (!currentEmail) return res.status(401).json({ message: "Unauthorized" });

  const { newEmail } = (req.body || {}) as { newEmail?: string };
  if (!newEmail || typeof newEmail !== "string") {
    return res.status(400).json({ message: "Invalid email" });
  }

  const normalizedNew = newEmail.trim().toLowerCase();

  if (!normalizedNew || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedNew)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  if (normalizedNew === currentEmail) {
    return res.status(400).json({ message: "New email matches current email" });
  }

  await dbConnect();

  // Duplicate account guard
  const conflict = await User.findOne({ email: normalizedNew }).lean();
  if (conflict) {
    return res.status(409).json({ message: "Email already in use" });
  }

  const user = await User.findOne({ email: currentEmail });
  if (!user) return res.status(404).json({ message: "User not found" });

  const oldEmail = user.email;

  // ── 1. Save new email on User ────────────────────────────────────────────
  user.email = normalizedNew;
  (user as any).previousEmails = [
    ...((user as any).previousEmails || []),
    oldEmail,
  ];
  await user.save();

  // ── 2. Cascade MongoDB ownership fields ──────────────────────────────────
  const cascadeResults = await cascadeEmailUpdateMany(oldEmail, normalizedNew);
  const cascadeErrors = cascadeResults.filter((r) => r.error);
  if (cascadeErrors.length) {
    console.error(
      "[update-email] cascade errors:",
      JSON.stringify(cascadeErrors),
    );
  }

  // ── 3. Stripe customer email ──────────────────────────────────────────────
  const stripeResult: { ok: boolean; error?: string } = { ok: true };
  const stripeCustomerId = user.stripeCustomerId;
  if (stripeCustomerId) {
    try {
      await stripe.customers.update(stripeCustomerId, { email: normalizedNew });
    } catch (e: any) {
      stripeResult.ok = false;
      stripeResult.error = e?.message || String(e);
      console.error("[update-email] Stripe update failed:", stripeResult.error);
    }
  }

  // ── 4. Twilio label updates ───────────────────────────────────────────────
  const twilioResult: { subaccount: boolean; messagingService: boolean; errors: string[] } = {
    subaccount: false,
    messagingService: false,
    errors: [],
  };

  const subaccountSid = user.twilio?.accountSid;
  if (subaccountSid) {
    try {
      const master = getPlatformTwilioClient();
      await (master as any).api.accounts(subaccountSid).update({
        friendlyName: `CoveCRM - ${normalizedNew}`,
      });
      twilioResult.subaccount = true;
    } catch (e: any) {
      const msg = `subaccount friendlyName: ${e?.message || String(e)}`;
      twilioResult.errors.push(msg);
      console.warn("[update-email] Twilio subaccount rename failed:", msg);
    }
  }

  const messagingServiceSid = user.a2p?.messagingServiceSid;
  if (messagingServiceSid) {
    try {
      const resolved = await getClientForUser(normalizedNew);
      await (resolved.client as any).messaging.v1
        .services(messagingServiceSid)
        .update({ friendlyName: `CoveCRM - ${normalizedNew}` });
      twilioResult.messagingService = true;
    } catch (e: any) {
      const msg = `messaging service friendlyName: ${e?.message || String(e)}`;
      twilioResult.errors.push(msg);
      console.warn("[update-email] Twilio messaging service rename failed:", msg);
    }
  }

  return res.status(200).json({
    message: "Email updated",
    requireRelogin: true,
    cascade: {
      collections: cascadeResults.length,
      errors: cascadeErrors.length,
    },
    stripe: stripeResult,
    twilio: twilioResult,
  });
}
