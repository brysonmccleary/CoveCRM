import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
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
        .json({ error: "Twilio environment variables missing" });
    }

    const identity = `user_${Math.floor(Math.random() * 1000000)}`;

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
