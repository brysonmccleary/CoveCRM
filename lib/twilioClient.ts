// lib/twilioClient.ts
import { getPlatformTwilioClient } from "@/lib/twilio/getPlatformClient";

const twilioClient = getPlatformTwilioClient();

export const sendSMS = async ({ to, body }: { to: string; body: string }) => {
  try {
    await twilioClient.messages.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER || "+18888675309",
      body,
    });
  } catch (error) {
    console.error("❌ Failed to send SMS via Twilio:", error);
    throw error;
  }
};

export default twilioClient;
