import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PhoneNumber from "@/models/PhoneNumber";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { stripe } from "@/lib/stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";
import { releaseLastNumberA2PResources } from "@/lib/billing/releaseUserPhoneNumbers";

function normalizeE164(p: string) {
  const digits = (p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return p.startsWith("+") ? p : `+${digits}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "DELETE")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  // We accept either a Twilio number SID or a phoneNumber (E.164) for flexibility
  const { sid, phoneNumber } = req.body as {
    sid?: string;
    phoneNumber?: string;
  };
  if (!sid && !phoneNumber) {
    return res
      .status(400)
      .json({ message: "Missing Twilio SID or phone number" });
  }

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Find the target number on the user by SID or phoneNumber
    const normalizedPhone = phoneNumber
      ? normalizeE164(phoneNumber)
      : undefined;
    const target =
      user.numbers?.find(
        (n: any) =>
          (sid && n.sid === sid) ||
          (normalizedPhone &&
            (n.phoneNumber === normalizedPhone ||
              n.phoneNumber === phoneNumber)),
      ) || null;

    if (!target)
      return res
        .status(404)
        .json({ message: "Number not found in user's account" });

    const twilioSid = target.sid || sid;
    const phone = target.phoneNumber || normalizedPhone || phoneNumber;

    // Keep the number if its recurring add-on cannot be stopped. This makes
    // cancellation fail closed and safe to retry instead of creating a ghost charge.
    if (target.subscriptionId) {
      try {
        assertStripeWritesEnabled();
        await stripe.subscriptions.cancel(target.subscriptionId);
      } catch (err: any) {
        const message = String(err?.message || err || "");
        if (err?.code === "resource_missing" || /no such subscription|already canceled/i.test(message)) {
          // The recurring charge is already gone; continue with Twilio cleanup.
        } else {
          console.error("Stripe number subscription cancellation failed:", err);
          return res.status(502).json({
            message: "Could not stop number billing; the number was kept so you can retry safely",
          });
        }
      }
    }

    const { client: twilioClient } = await getClientForUser(String(user.email));

    // 2) Unlink from ANY Messaging Service sender pool so it can be reused later
    try {
      if (twilioSid) {
        const services = await twilioClient.messaging.v1.services.list({
          limit: 100,
        });
        for (const svc of services) {
          try {
            await twilioClient.messaging.v1
              .services(svc.sid)
              .phoneNumbers(twilioSid)
              .remove();
          } catch {
            // ignore if not linked to this service
          }
        }
      } else if (phone) {
        // If no SID, try to find by phone and then unlink by SID
        const matches = await twilioClient.incomingPhoneNumbers.list({
          phoneNumber: normalizeE164(phone),
          limit: 5,
        });
        if (matches && matches.length > 0) {
          const foundSid = matches[0].sid;
          const services = await twilioClient.messaging.v1.services.list({
            limit: 100,
          });
          for (const svc of services) {
            try {
              await twilioClient.messaging.v1
                .services(svc.sid)
                .phoneNumbers(foundSid)
                .remove();
            } catch {}
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Unlink from Messaging Services warning:", err);
    }

    // 3) Release the number in the user's isolated Twilio account. Do not
    // clear ownership locally unless the provider accepted the release.
    try {
      if (twilioSid) {
        await twilioClient.incomingPhoneNumbers(twilioSid).remove();
      } else if (phone) {
        const matches = await twilioClient.incomingPhoneNumbers.list({
          phoneNumber: normalizeE164(phone),
          limit: 5,
        });
        if (matches && matches.length > 0) {
          await twilioClient.incomingPhoneNumbers(matches[0].sid).remove();
        }
      }
    } catch (err: any) {
      if (err?.status !== 404 && err?.code !== 20404 && !/not found|no record/i.test(String(err?.message || err))) {
        console.error("Twilio number release failed:", err);
        return res.status(502).json({
          message: err?.message || "Could not release the Twilio number; please retry",
        });
      }
    }

    // 4) Remove from user.numbers[]
    user.numbers = user.numbers?.filter(
      (n: any) =>
        (twilioSid ? n.sid !== twilioSid : true) &&
        (phone
          ? n.phoneNumber !== normalizeE164(phone) && n.phoneNumber !== phone
          : true),
    );
    await user.save();

    const a2pCleanup = await releaseLastNumberA2PResources({
      userId: String(user._id),
      reason: "legacy_cancel_number",
    });

    // 5) Delete PhoneNumber doc(s) (tidy)
    try {
      if (phone) {
        await PhoneNumber.deleteOne({
          userId: user._id,
          phoneNumber: normalizeE164(phone),
        });
        await PhoneNumber.deleteOne({ userId: user._id, phoneNumber }); // in case stored un-normalized
      } else if (twilioSid) {
        await PhoneNumber.deleteOne({ userId: user._id, twilioSid });
      }
    } catch (err) {
      console.warn("⚠️ PhoneNumber doc delete warning:", err);
    }

    return res.status(200).json({
      message: `Number ${phone || twilioSid} cancelled, unlinked, released, and removed`,
      a2pCleanup,
    });
  } catch (err: any) {
    console.error("Cancel number error:", err);
    return res
      .status(500)
      .json({ message: err?.message || "Failed to cancel number" });
  }
}
