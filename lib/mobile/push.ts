// /lib/mobile/push.ts
// Helper for sending Expo push notifications to CoveCRM mobile devices.

import mongooseConnect from "@/lib/mongooseConnect";
import MobileDevice from "@/models/MobileDevice";
import { Expo, ExpoPushMessage } from "expo-server-sdk";

const expo = new Expo();

/**
 * Send a generic push notification to all active devices for a given user email.
 *
 * @param userEmail the user's email (case-insensitive)
 * @param options   { title, body, data? }
 */
export async function sendPushToUserEmail(
  userEmail: string,
  options: {
    title: string;
    body: string;
    data?: Record<string, any>;
  },
) {
  const normalizedEmail = (userEmail || "").toLowerCase();
  if (!normalizedEmail) return;

  await mongooseConnect();

  const devices = await MobileDevice.find({
    userEmail: normalizedEmail,
    disabled: { $ne: true },
  }).lean();

  if (!devices.length) {
    console.log("[push] No active devices for", normalizedEmail);
    return;
  }

  const messages: ExpoPushMessage[] = [];

  for (const device of devices) {
    const token = device.expoPushToken as string | undefined;
    if (!token) continue;

    if (!Expo.isExpoPushToken(token)) {
      console.warn("[push] Invalid Expo push token, disabling device:", token);
      // soft disable this device record so we stop trying it
      await MobileDevice.updateOne(
        { _id: device._id },
        { $set: { disabled: true } },
      );
      continue;
    }

    messages.push({
      to: token,
      sound: "default",
      title: options.title,
      body: options.body,
      data: {
        ...options.data,
        // always include a type for the app to branch on if needed
        _type: options.data?._type || "generic",
      },
    });
  }

  if (!messages.length) {
    console.log("[push] No valid Expo tokens for", normalizedEmail);
    return;
  }

  const chunks = expo.chunkPushNotifications(messages);

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log("[push] Tickets:", ticketChunk);
    } catch (err) {
      console.error("[push] Error sending push chunk:", err);
    }
  }
}

/**
 * Convenience helper: push for an incoming SMS message.
 *
 * Call this from your Twilio inbound SMS webhook after saving the message.
 */
export async function sendIncomingSmsPush(options: {
  userEmail: string;
  fromPhone: string;
  previewText: string;
  conversationId?: string;
  messageId?: string;
}) {
  const { userEmail, fromPhone, previewText, conversationId, messageId } =
    options;

  await sendPushToUserEmail(userEmail, {
    title: `New text from ${fromPhone}`,
    body: previewText || "New incoming message",
    data: {
      _type: "incoming_sms",
      fromPhone,
      conversationId,
      messageId,
    },
  });
}
