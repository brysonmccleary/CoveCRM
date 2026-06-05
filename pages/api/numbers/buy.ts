import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongodb";
import Number from "@/models/Number";
import User from "@/models/User";
import PhoneNumber from "@/models/PhoneNumber";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { ensureMessagingServiceA2PReadyForUser } from "@/lib/a2p/ensureMessagingServiceA2PReady";
import { requireBillingReady } from "@/lib/billing/requireBillingReady";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const userEmail = session.user.email;

  if (req.method === "POST") {
    try {
      const { areaCode } = req.body;
      const user = await User.findOne({ email: userEmail });
      if (!user) return res.status(404).json({ message: "User not found" });

      const billingReady = requireBillingReady(user);
      if (!billingReady.ok) {
        return res.status(402).json({ error: "billing_required", reason: billingReady.reason, redirect: billingReady.redirect });
      }

      const { client, accountSid } = await getClientForUser(userEmail);

      const availableNumbers = await client
        .availablePhoneNumbers("US")
        .local.list({
          areaCode,
          limit: 1,
        });

      if (availableNumbers.length === 0) {
        return res
          .status(404)
          .json({ message: "No numbers available for this area code" });
      }

      const purchasedNumber = await client.incomingPhoneNumbers.create({
        phoneNumber: availableNumbers[0].phoneNumber,
      });

      let readiness: any = null;
      let warning: string | null = null;
      try {
        readiness = await ensureMessagingServiceA2PReadyForUser(user, {
          purchasedNumberSid: purchasedNumber.sid,
          repair: true,
          attachNumbers: true,
          logPrefix: "buy-number-web",
        });
      } catch (err: any) {
        warning = err?.message || "A2P messaging service not registered";
        console.warn("buy-number: A2P verification failed after purchase", {
          userEmail,
          phoneNumber: purchasedNumber.phoneNumber,
          sid: purchasedNumber.sid,
          error: warning,
        });
      }

      const a2pApproved = readiness?.canSendSms === true;
      const newNumber = new Number({
        phoneNumber: purchasedNumber.phoneNumber,
        friendlyName: purchasedNumber.friendlyName,
        sid: purchasedNumber.sid,
        userEmail,
      });

      await newNumber.save();
      await PhoneNumber.updateOne(
        { phoneNumber: purchasedNumber.phoneNumber },
        {
          $set: {
            userId: user._id,
            phoneNumber: purchasedNumber.phoneNumber,
            twilioSid: purchasedNumber.sid,
            friendlyName: purchasedNumber.friendlyName,
            messagingServiceSid: a2pApproved ? readiness.messagingServiceSid : null,
            a2pApproved,
            smsBlockedReason: a2pApproved ? null : "A2P messaging service not registered",
            datePurchased: new Date(),
          },
        },
        { upsert: true },
      );

      res.status(201).json({
        ...newNumber.toObject(),
        accountSid,
        messagingServiceSid: a2pApproved ? readiness.messagingServiceSid : null,
        a2pApproved,
        warning: a2pApproved ? null : warning || "A2P messaging service not registered",
      });
    } catch (error) {
      console.error("Buy number error:", error);
      res.status(500).json({ message: "Failed to buy number" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}
