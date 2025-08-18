// lib/twilio/configureWebhook.ts
import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

export async function configureTwilioWebhook(phoneNumber: string) {
  const VOICE_WEBHOOK_URL = `${process.env.NEXT_PUBLIC_BASE_URL}/api/twilio/inbound-callback`;

  try {
    // Find the phone number SID by number
    const number = await client.incomingPhoneNumbers
      .list({ phoneNumber, limit: 1 })
      .then((results) => results[0]);

    if (!number)
      throw new Error(`Number ${phoneNumber} not found in Twilio account`);

    // Update webhook
    await client.incomingPhoneNumbers(number.sid).update({
      voiceUrl: VOICE_WEBHOOK_URL,
      voiceMethod: "POST",
    });

    console.log(`✅ Webhook set for ${phoneNumber}`);
  } catch (error) {
    console.error(`❌ Failed to set webhook for ${phoneNumber}:`, error);
  }
}
