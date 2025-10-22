// /lib/billing/smsPricing.ts
/**
 * Estimate Twilio SMS/MMS cost and apply a configurable multiplier.
 * Defaults roughly match US SMS pricing. Override via env.
 *
 * Env:
 * - SMS_BASE_COST              default 0.0075 (per 160/70-char segment)
 * - MMS_BASE_COST              default 0.0200 (flat per MMS)
 * - SMS_BILLING_MULTIPLIER     default 2.0   (to cover AI, support, overhead, etc.)
 */
const SMS_BASE_COST = parseFloat(process.env.SMS_BASE_COST || "0.0075");
const MMS_BASE_COST = parseFloat(process.env.MMS_BASE_COST || "0.0200");
const SMS_BILLING_MULTIPLIER = parseFloat(process.env.SMS_BILLING_MULTIPLIER || "2");

function isGsm7(text: string): boolean {
  // Very safe check: if any character > 0x7F, treat as UCS-2
  // (Twilio uses GSM-7 + extended set; this approximation is good enough for pricing)
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

function countSmsSegments(text: string): number {
  const content = text || "";
  const gsm = isGsm7(content);
  const perSeg = gsm ? 160 : 70;
  const perSegConcat = gsm ? 153 : 67; // concat segments reserve UDH
  if (content.length <= perSeg) return content.length ? 1 : 1;
  return Math.ceil(content.length / perSegConcat);
}

/** Returns the *billed* amount for a single outbound message (estimated). */
export function estimateSmsChargeUSD(params: { body: string; mediaUrls?: string[] | null }): number {
  const { body, mediaUrls } = params;
  const isMms = Array.isArray(mediaUrls) && mediaUrls.length > 0;
  const base = isMms ? MMS_BASE_COST : SMS_BASE_COST;
  const multiplier = isNaN(SMS_BILLING_MULTIPLIER) ? 1 : SMS_BILLING_MULTIPLIER;

  if (isMms) {
    return +(base * multiplier).toFixed(6);
  }
  const segments = countSmsSegments(body || "");
  return +(base * segments * multiplier).toFixed(6);
}
