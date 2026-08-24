import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongodb";
import Number from "@/models/Number";
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
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const userEmail = session.user.email.toLowerCase();
  const { id, force } = req.query;

  try {
    const number = await Number.findOne({ _id: id, userEmail });

    if (!number) {
      return res.status(404).json({ message: "Number not found or access denied" });
    }

    if (req.method === "DELETE") {
      const forceRelease = force === "true";
      const user = await User.findOne({ email: userEmail });
      if (!user) return res.status(404).json({ message: "User not found" });
      const twilioSid = String((number as any).sid || (number as any).twilioSid || "");
      const userNumber: any = (user.numbers || []).find(
        (entry: any) => entry?.sid === twilioSid || entry?.phoneNumber === number.phoneNumber,
      );

      if (!forceRelease) {
        // Check if this is the user's default SMS number
        const defaultId = String((user as any)?.defaultSmsNumberId || "");
        const isDefault = defaultId && (defaultId === String(id) || defaultId === twilioSid);

        if (isDefault) {
          return res.status(409).json({
            requiresConfirmation: true,
            message: "This is your default SMS number. Releasing it will stop outbound SMS from using this number. Are you sure?",
          });
        }

        // Check for active drip enrollments (if DripEnrollment model exists)
        try {
          const DripEnrollment = (await import("@/models/DripEnrollment")).default;
          const activeCount = await (DripEnrollment as any).countDocuments({
            userEmail,
            status: "active",
          });
          if (activeCount > 0) {
            return res.status(409).json({
              requiresConfirmation: true,
              message: `This account has ${activeCount} active drip campaign(s). Releasing this number may stop those drips from sending. Are you sure?`,
            });
          }
        } catch {
          // DripEnrollment model may not exist in this build — skip check
        }
      }

      if (userNumber?.subscriptionId) {
        try {
          assertStripeWritesEnabled();
          await stripe.subscriptions.cancel(userNumber.subscriptionId);
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

      if (!twilioSid) return res.status(409).json({ message: "Number is missing its Twilio SID" });
      const { client: twilioClient } = await getClientForUser(userEmail);
      try {
        await twilioClient.incomingPhoneNumbers(twilioSid).remove();
      } catch (error: any) {
        if (error?.status !== 404 && error?.code !== 20404 && !/not found|no record/i.test(String(error?.message || error))) {
          throw error;
        }
      }
      await number.deleteOne();
      user.numbers = (user.numbers || []).filter(
        (entry: any) => entry?.sid !== twilioSid && entry?.phoneNumber !== number.phoneNumber,
      );
      await user.save();
      await PhoneNumber.deleteMany({
        userId: user._id,
        $or: [{ twilioSid }, { phoneNumber: number.phoneNumber }],
      });
      const a2pCleanup = await releaseLastNumberA2PResources({
        userId: String(user._id),
        reason: "number_record_delete",
      });
      res.status(200).json({ message: "Number deleted", a2pCleanup });
    } else {
      res.status(405).json({ message: "Method not allowed" });
    }
  } catch (error) {
    console.error("Delete number error:", error);
    res.status(500).json({ message: "Failed to delete number" });
  }
}
