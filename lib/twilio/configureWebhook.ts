// /lib/twilio/configureWebhook.ts
import type { Twilio } from "twilio";

type Targets = {
  smsUrl?: string;
  voiceUrl?: string;
  smsMethod?: "POST" | "GET";
  voiceMethod?: "POST" | "GET";
};

/** Ensure inbound webhooks on a specific number within the *provided* Twilio account. */
export async function configureTwilioWebhookForNumber(
  client: Twilio,
  opts: { phoneNumber?: string; numberSid?: string } & Targets,
) {
  const { phoneNumber, numberSid, smsUrl, voiceUrl, smsMethod = "POST", voiceMethod = "POST" } = opts;

  let sid = numberSid;

  if (!sid) {
    if (!phoneNumber) throw new Error("Provide phoneNumber or numberSid");
    const match = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
    if (!match.length) throw new Error(`Number ${phoneNumber} not found in this Twilio account`);
    sid = match[0].sid;
  }

  const update: any = {};
  if (smsUrl) update.smsUrl = smsUrl, (update.smsMethod = smsMethod);
  if (voiceUrl) update.voiceUrl = voiceUrl, (update.voiceMethod = voiceMethod);

  if (Object.keys(update).length === 0) return;

  await client.incomingPhoneNumbers(sid!).update(update);
}
