// lib/twilio/checkSpamStatus.ts
// Check a phone number's spam reputation via YouMail API
import axios from "axios";

export interface SpamCheckResult {
  spamScore: number;
  spamLabel: string;
  isSpam: boolean;
  raw: any;
}

export async function checkSpamStatus(phoneNumber: string): Promise<SpamCheckResult> {
  const apiUsername = process.env.YOUMAIL_API_USERNAME;
  const apiPassword = process.env.YOUMAIL_API_PASSWORD;

  if (!apiUsername || !apiPassword) {
    return { spamScore: 0, spamLabel: "Unknown", isSpam: false, raw: {} };
  }

  // Normalize to E.164-ish: digits only
  const digits = phoneNumber.replace(/\D/g, "").replace(/^1/, "");
  if (digits.length !== 10) {
    return { spamScore: 0, spamLabel: "Invalid number", isSpam: false, raw: {} };
  }

  try {
    const url = `https://api.youmail.com/phone/v2/info/${digits}`;
    const res = await axios.get(url, {
      params: { apiUsername, apiPassword },
      timeout: 8000,
    });

    const data = res.data ?? {};
    const spamScore = typeof data.spamRisk === "number" ? Math.round(data.spamRisk) : 0;
    const spamLabel = data.phoneActivity?.label || (spamScore >= 75 ? "Spam Risk" : "Clean");
    const isSpam = spamScore >= 75;

    return { spamScore, spamLabel, isSpam, raw: data };
  } catch (err: any) {
    console.warn("[checkSpamStatus] YouMail error:", err?.message);
    return { spamScore: 0, spamLabel: "Check failed", isSpam: false, raw: {} };
  }
}
