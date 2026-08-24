import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PhoneNumber from "@/models/PhoneNumber";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { stripe } from "@/lib/stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";
import { releaseLastNumberA2PResources } from "@/lib/billing/releaseUserPhoneNumbers";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  const { sid } = req.body;

  if (!sid) {
    return res.status(400).json({ message: "Missing SID" });
  }

  try {
    await dbConnect();
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const numbers = Array.isArray(user.numbers) ? user.numbers : [];
    const entryIndex = numbers.findIndex((n: any) => n?.sid === sid);
    if (entryIndex === -1) {
      return res.status(403).json({ message: "Number not found on your account" });
    }

    const target: any = numbers[entryIndex];
    if (target?.subscriptionId) {
      try {
        assertStripeWritesEnabled();
        await stripe.subscriptions.cancel(target.subscriptionId);
      } catch (error: any) {
        const message = String(error?.message || error || "");
        if (error?.code === "resource_missing" || /no such subscription|already canceled/i.test(message)) {
          // Already non-billable; continue with the provider release.
        } else {
          console.error("Stripe number subscription cancellation failed:", error);
          return res.status(502).json({
            message: "Could not stop number billing; the number was kept so you can retry safely",
          });
        }
      }
    }

    const { client: twilioClient } = await getClientForUser(String(user.email));
    try {
      await twilioClient.incomingPhoneNumbers(sid).remove();
    } catch (error: any) {
      if (error?.status !== 404 && error?.code !== 20404 && !/not found|no record/i.test(String(error?.message || error))) {
        throw error;
      }
    }

    user.numbers = numbers.filter((n: any) => n?.sid !== sid);
    await user.save();

    const phoneNumberFilters: Record<string, string>[] = [{ twilioSid: sid }];
    if (target?.phoneNumber) phoneNumberFilters.push({ phoneNumber: target.phoneNumber });
    await PhoneNumber.deleteMany({ userId: user._id, $or: phoneNumberFilters });
    const a2pCleanup = await releaseLastNumberA2PResources({
      userId: String(user._id),
      reason: "legacy_delete_number",
    });

    res.status(200).json({ message: "Number deleted successfully", a2pCleanup });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting number" });
  }
}
