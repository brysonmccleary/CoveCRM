// lib/twilioClient.ts
import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;

const twilioClient = twilio(accountSid, authToken);

export const sendSMS = async ({
  to,
  body,
}: {
  to: string;
  body: string;
}) => {
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
