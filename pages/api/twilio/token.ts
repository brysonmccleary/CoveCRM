import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import twilio from "twilio";
import { checkCallingAllowed } from "@/lib/billing/checkCallingAllowed";

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const identity = session?.user?.email?.toLowerCase();
    if (!identity) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const billingCheck = await checkCallingAllowed(identity);
    if (!billingCheck.allowed) {
      return res.status(402).json({
        error: "billing_required",
        reason: billingCheck.reason,
        redirect: billingCheck.redirect,
      });
    }

    const {
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET,
      TWILIO_APP_SID,
    } = process.env;

    if (
      !TWILIO_ACCOUNT_SID ||
      !TWILIO_API_KEY_SID ||
      !TWILIO_API_KEY_SECRET ||
      !TWILIO_APP_SID
    ) {
      return res
        .status(500)
        .json({ error: "Calling is temporarily unavailable. Please try again later." });
    }

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWILIO_APP_SID,
      incomingAllow: true,
    });

    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET,
      { identity },
    );

    token.addGrant(voiceGrant);

    res.status(200).json({ token: token.toJwt(), identity });
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
}
