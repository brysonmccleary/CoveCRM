// /lib/twilio/getClientForUser.ts
import twilio, { Twilio } from "twilio";
import User from "@/models/User";
import dbConnect from "@/lib/mongooseConnect";

export async function getClientForUser(email: string): Promise<{ client: Twilio; usingPersonal: boolean }> {
  await dbConnect();
  const user = await User.findOne({ email: email.toLowerCase() }).lean<any>();
  const u = user || {};
  const hasPersonal = !!(u.twilio?.accountSid && u.twilio?.apiKeySid && u.twilio?.apiKeySecret);
  const usePersonal = u.billingMode === "self" && hasPersonal;

  const accountSid   = usePersonal ? u.twilio.accountSid       : process.env.TWILIO_ACCOUNT_SID!;
  const apiKeySid    = usePersonal ? u.twilio.apiKeySid        : (process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID!);
  const apiKeySecret = usePersonal ? u.twilio.apiKeySecret     : (process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN!);

  return { client: twilio(apiKeySid, apiKeySecret, { accountSid }), usingPersonal: usePersonal };
}
