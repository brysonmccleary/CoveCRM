import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PhoneNumber from "@/models/PhoneNumber";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

function normalizeE164(input: string) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return String(input || "").startsWith("+") ? String(input || "") : `+${digits}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  try {
    await dbConnect();
    const user = await User.findOne({ email: session.user.email });
    if (!user) {
      return res.status(200).json({ numbers: [] });
    }

    const storedNumbers = Array.isArray(user.numbers) ? user.numbers : [];
    const storedByPhone = new Set(
      storedNumbers.map((num: any) => normalizeE164(num?.phoneNumber || "")).filter(Boolean),
    );
    const defaultSmsNumberId = String((user as any).defaultSmsNumberId || "");
    let numbersChanged = false;

    const phoneDocs = await PhoneNumber.find({ userId: user._id })
      .select("phoneNumber twilioSid friendlyName messagingServiceSid a2pApproved datePurchased")
      .lean();

    if (phoneDocs.length > 0) {
      const { client } = await getClientForUser(session.user.email);

      for (const doc of phoneDocs) {
        const phoneNumber = normalizeE164(String((doc as any).phoneNumber || ""));
        if (!phoneNumber || storedByPhone.has(phoneNumber)) continue;

        try {
          const matches = await client.incomingPhoneNumbers.list({
            phoneNumber,
            limit: 1,
          });
          if (!Array.isArray(matches) || matches.length === 0) continue;

          const twilioNumber = matches[0];
          user.numbers = user.numbers || [];
          user.numbers.push({
            sid: String((doc as any).twilioSid || twilioNumber.sid || ""),
            phoneNumber,
            purchasedAt: (doc as any).datePurchased || new Date(),
            messagingServiceSid:
              (doc as any).messagingServiceSid || undefined,
            friendlyName:
              (doc as any).friendlyName ||
              twilioNumber.friendlyName ||
              phoneNumber,
            status: "active",
            capabilities: {
              voice: twilioNumber.capabilities?.voice,
              sms:
                (twilioNumber as any).capabilities?.SMS ??
                twilioNumber.capabilities?.sms,
              mms:
                (twilioNumber as any).capabilities?.MMS ??
                twilioNumber.capabilities?.mms,
            },
          } as any);
          storedByPhone.add(phoneNumber);
          numbersChanged = true;
        } catch (err) {
          console.warn("getNumbers: failed to verify missing number on Twilio", {
            userEmail: session.user.email,
            phoneNumber,
            error: (err as any)?.message || err,
          });
        }
      }
    }

    const syncedNumbers = Array.isArray(user.numbers) ? user.numbers : [];
    const defaultStillValid = syncedNumbers.some((num: any) => {
      const entryId = num?._id ? String(num._id) : "";
      return defaultSmsNumberId === entryId || defaultSmsNumberId === String(num?.sid || "");
    });

    if (!defaultStillValid && syncedNumbers.length === 1) {
      const onlyNumber = syncedNumbers[0] as any;
      user.defaultSmsNumberId = String(onlyNumber?._id || onlyNumber?.sid || "");
      numbersChanged = true;
    }

    if (numbersChanged) {
      await user.save();
    }

    const enrichedNumbers = await Promise.all(
      (user.numbers || []).map(async (num: any) => {
        let status = "unknown";
        let nextBillingDate: string | null = null;

        if (num.subscriptionId) {
          try {
            const subResp = await stripe.subscriptions.retrieve(num.subscriptionId);
            const sub = subResp as unknown as Stripe.Subscription;
            status = sub.status;
            nextBillingDate = sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null;
          } catch (err) {
            console.warn(`❗ Failed to fetch Stripe subscription for ${num.phoneNumber}`, err);
          }
        }

        return {
          _id: String(num._id),
          sid: num.sid,
          phoneNumber: num.phoneNumber,
          subscriptionStatus: status,
          nextBillingDate,
          usage: num.usage || {
            callsMade: 0,
            callsReceived: 0,
            textsSent: 0,
            textsReceived: 0,
            cost: 0,
          },
        };
      }),
    );

    return res.status(200).json({ numbers: enrichedNumbers });
  } catch (err) {
    console.error("❌ Failed to fetch numbers:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}
