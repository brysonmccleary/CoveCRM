import PhoneNumber from "@/models/PhoneNumber";
import Number from "@/models/Number";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { resolvePreferredSmsDefault } from "@/lib/twilio/resolvePreferredSmsDefault";

function normalizeE164(input: string) {
  const digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return String(input || "").startsWith("+")
    ? String(input || "")
    : `+${digits}`;
}

export async function reconcileUserNumbers(user: any, email: string) {
  if (!user?._id || !email) return { user, changed: false };

  user.numbers = Array.isArray(user.numbers) ? user.numbers : [];
  const storedNumbers = user.numbers;
  const storedEntries = storedNumbers
    .map(
      (num: any): [string, any] => [normalizeE164(num?.phoneNumber || ""), num],
    )
    .filter((entry: [string, any]) => Boolean(entry[0]));
  const storedByPhone = new Map<string, any>(storedEntries);
  let changed = false;

  const [phoneDocs, legacyNumberDocs] = await Promise.all([
    PhoneNumber.find({ userId: user._id })
      .select(
        "phoneNumber twilioSid friendlyName messagingServiceSid a2pApproved datePurchased",
      )
      .lean(),
    Number.find({ userEmail: String(email).toLowerCase() })
      .select("phoneNumber sid friendlyName createdAt")
      .lean(),
  ]);

  const candidateByPhone = new Map<string, any>();
  const mergeCandidate = (candidate: {
    phoneNumber?: string;
    sid?: string;
    friendlyName?: string;
    messagingServiceSid?: string;
    purchasedAt?: Date;
  }) => {
    const phoneNumber = normalizeE164(String(candidate.phoneNumber || ""));
    if (!phoneNumber) return;

    const existing = candidateByPhone.get(phoneNumber) || {};
    candidateByPhone.set(phoneNumber, {
      phoneNumber,
      sid: existing.sid || candidate.sid || "",
      friendlyName: existing.friendlyName || candidate.friendlyName || "",
      messagingServiceSid:
        existing.messagingServiceSid || candidate.messagingServiceSid || "",
      purchasedAt: existing.purchasedAt || candidate.purchasedAt || undefined,
    });
  };

  for (const doc of phoneDocs) {
    mergeCandidate({
      phoneNumber: String((doc as any).phoneNumber || ""),
      sid: String((doc as any).twilioSid || ""),
      friendlyName: String((doc as any).friendlyName || ""),
      messagingServiceSid: String((doc as any).messagingServiceSid || ""),
      purchasedAt: (doc as any).datePurchased || undefined,
    });
  }

  for (const doc of legacyNumberDocs) {
    mergeCandidate({
      phoneNumber: String((doc as any).phoneNumber || ""),
      sid: String((doc as any).sid || ""),
      friendlyName: String((doc as any).friendlyName || ""),
      purchasedAt: (doc as any).createdAt || undefined,
    });
  }

  if (candidateByPhone.size > 0) {
    const { client } = await getClientForUser(email);

    for (const [phoneNumber, candidate] of candidateByPhone.entries()) {
      try {
        const matches = await client.incomingPhoneNumbers.list({
          phoneNumber,
          limit: 1,
        });
        if (!Array.isArray(matches) || matches.length === 0) continue;

        const twilioNumber = matches[0];
        const existing = storedByPhone.get(phoneNumber) as any;
        const nextValues = {
          sid: String(candidate.sid || twilioNumber.sid || ""),
          phoneNumber,
          purchasedAt: candidate.purchasedAt || new Date(),
          messagingServiceSid: candidate.messagingServiceSid || undefined,
          friendlyName:
            candidate.friendlyName || twilioNumber.friendlyName || phoneNumber,
          status: "active",
          capabilities: {
            voice: twilioNumber.capabilities?.voice,
            sms:
              (twilioNumber as any).capabilities?.SMS ??
              twilioNumber.capabilities?.sms,
            mms:
              (twilioNumber as any).capabilities?.MMS ??
              twilioNumber.capabilities?.mms,
          },
        };

        if (!existing) {
          user.numbers.push(nextValues as any);
          storedByPhone.set(phoneNumber, user.numbers[user.numbers.length - 1]);
          changed = true;
          continue;
        }

        let entryChanged = false;
        for (const [key, value] of Object.entries(nextValues)) {
          const current =
            key === "capabilities"
              ? JSON.stringify(existing[key] || {})
              : existing[key];
          const next =
            key === "capabilities" ? JSON.stringify(value || {}) : value;
          if (!current && value) {
            existing[key] = value;
            entryChanged = true;
            continue;
          }
          if (key === "status" && existing[key] !== "active") {
            existing[key] = value;
            entryChanged = true;
          }
        }
        if (entryChanged) changed = true;
      } catch (err) {
        console.warn("reconcileUserNumbers: failed to verify missing number on Twilio", {
          userEmail: email,
          phoneNumber,
          error: (err as any)?.message || err,
        });
      }
    }
  }

  const preferredDefault = await resolvePreferredSmsDefault(user, { save: false });
  if (preferredDefault.changed) changed = true;

  if (changed && typeof user.save === "function") {
    if (typeof user.markModified === "function") {
      user.markModified("numbers");
      user.markModified("defaultSmsNumberId");
    }
    await user.save();
  }

  return { user, changed };
}
