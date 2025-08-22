import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const { AccessToken } = (twilio.jwt as any);
const { VoiceGrant } = AccessToken;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    console.error("❌ voice/token: Unauthorized (no session)");
    return res.status(401).json({ message: "Unauthorized" });
  }

  const email = session.user.email.toLowerCase();

  try {
    await dbConnect();

    // Determine which Twilio account to use (personal vs platform)
    const { usingPersonal, accountSid } = await getClientForUser(email);

    // Collect credentials
    let ACCOUNT_SID: string | undefined;
    let API_KEY_SID: string | undefined;
    let API_KEY_SECRET: string | undefined;
    let OUTGOING_APP_SID: string | undefined;

    if (usingPersonal) {
      // Per-user creds from DB
      const user = await User.findOne({ email }).lean<any>();
      ACCOUNT_SID = user?.twilio?.accountSid;
      API_KEY_SID = user?.twilio?.apiKeySid;
      API_KEY_SECRET = user?.twilio?.apiKeySecret;

      // Prefer a per-user app SID, but FALL BACK to env (so browser can route to /api/voice/agent-join)
      OUTGOING_APP_SID =
        user?.twilio?.voiceAppSid ||
        process.env.TWILIO_VOICE_APP_SID ||
        process.env.OUTGOING_APP_SID ||
        process.env.TWILIO_APP_SID ||
        process.env.TWILIO_TWIML_APP_SID ||
        undefined;
    } else {
      // Platform envs
      ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
      API_KEY_SID = process.env.TWILIO_API_KEY_SID || process.env.TWILIO_API_KEY;
      API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET;
      OUTGOING_APP_SID =
        process.env.TWILIO_VOICE_APP_SID ||
        process.env.OUTGOING_APP_SID ||
        process.env.TWILIO_APP_SID ||
        process.env.TWILIO_TWIML_APP_SID ||
        undefined;
    }

    // Minimal requirements for a JWT
    if (!ACCOUNT_SID || !API_KEY_SID || !API_KEY_SECRET) {
      console.error(
        "❌ voice/token: Missing credentials for AccessToken",
        JSON.stringify({
          email,
          usingPersonal,
          resolvedAccountSidMasked: maskSid(accountSid),
          hasAccountSid: !!ACCOUNT_SID,
          hasApiKeySid: !!API_KEY_SID,
          hasApiKeySecret: !!API_KEY_SECRET,
        })
      );
      return res.status(500).json({ message: "Server voice config missing" });
    }

    const identity = email;
    const token = new AccessToken(ACCOUNT_SID, API_KEY_SID, API_KEY_SECRET, {
      identity,
      ttl: 3600,
    });

    // Build the Voice grant
    const grantOptions: Record<string, any> = { incomingAllow: true };
    if (OUTGOING_APP_SID) {
      grantOptions.outgoingApplicationSid = OUTGOING_APP_SID;
    } else {
      console.warn(
        JSON.stringify({
          msg: "voice/token: OUTGOING_APP_SID not set; Device.connect() will not reach /api/voice/agent-join",
          email,
          usingPersonal,
          accountSidMasked: maskSid(ACCOUNT_SID),
        })
      );
    }

    const voiceGrant = new VoiceGrant(grantOptions);
    token.addGrant(voiceGrant);

    // Return token + the app SID so we can verify easily
    return res.status(200).json({
      token: token.toJwt(),
      identity,
      usingPersonal,
      accountSid,
      outgoingAppSid: OUTGOING_APP_SID || null,
    });
  } catch (err: any) {
    console.error("❌ voice/token error:", err);
    return res.status(500).json({ message: "Unable to generate token" });
  }
}

// small helper for logs
function maskSid(sid?: string | null) {
  if (!sid) return null;
  const s = String(sid);
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
