// lib/twilio/checkSpamStatus.ts
// Carrier reputation checks are intentionally disabled until Twilio Voice Integrity is implemented.

export interface SpamCheckResult {
  spamScore: number;
  spamLabel: string;
  isSpam: boolean;
  raw: any;
}

export async function checkSpamStatus(phoneNumber: string): Promise<SpamCheckResult> {
  return {
    spamScore: 0,
    spamLabel: "Unknown",
    isSpam: false,
    raw: {
      provider: "twilio",
      status: "not_configured",
      reason: "Twilio Voice Integrity reputation checks are not implemented yet.",
      phoneNumber,
    },
  };
}
