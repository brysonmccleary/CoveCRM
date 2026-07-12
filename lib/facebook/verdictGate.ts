// lib/facebook/verdictGate.ts
// Shared minimum-data gate for anything that renders a performance verdict — a performanceClass,
// an alert, a recommendation message, or an email — about a campaign or an individual ad.
// One definition, imported everywhere. No verdict should ever fire on a sample size too small
// to mean anything; that's how a "your ad is failing" email gets sent after one lead.

export const MIN_VERDICT_LEADS = 5;
export const MIN_VERDICT_SPEND = 50;
export const MIN_VERDICT_AGE_MS = 72 * 60 * 60 * 1000; // 72 hours

export interface VerdictGateInput {
  leads?: number | null;
  spend?: number | null;
  // Optional — individual ads inside a campaign don't carry their own launch timestamp today
  // (no createdAt on the ads[] subdocument). When createdAt is absent, the age check is skipped
  // rather than permanently blocking a verdict that has no way to ever satisfy it.
  createdAt?: Date | string | null;
  now?: Date;
}

export function hasEnoughData(input: VerdictGateInput): boolean {
  const leads = Number(input.leads || 0);
  const spend = Number(input.spend || 0);

  if (leads < MIN_VERDICT_LEADS) return false;
  if (spend < MIN_VERDICT_SPEND) return false;

  if (input.createdAt) {
    const createdAt = input.createdAt instanceof Date ? input.createdAt : new Date(input.createdAt);
    const now = input.now || new Date();
    if (!Number.isNaN(createdAt.getTime()) && now.getTime() - createdAt.getTime() < MIN_VERDICT_AGE_MS) {
      return false;
    }
  }

  return true;
}
