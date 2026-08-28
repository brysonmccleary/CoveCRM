export type FamilyEvidence = {
  spend: number;
  impressions: number;
  leads: number;
  qualifiedLeads: number;
  appointments: number;
  sales: number;
  ctr?: number | null;
  cpc?: number | null;
  lastSeenAt?: Date | string | null;
};

export type GuardedFamilyScore = {
  multiplier: number;
  confidence: number;
  eligibleForBoost: boolean;
  evidenceTier: "insufficient" | "developing" | "qualified" | "proven";
  reasons: string[];
};

export const PERFORMANCE_GUARDS = {
  minimumSpend: 150,
  minimumImpressions: 5_000,
  minimumLeads: 20,
  minimumQualifiedLeads: 8,
  minimumAppointments: 3,
  provenSales: 3,
  maximumBoost: 1.35,
  maximumPenalty: 0.75,
};

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function scoreFamilyEvidence(evidence: FamilyEvidence): GuardedFamilyScore {
  const spend = finite(evidence.spend);
  const impressions = finite(evidence.impressions);
  const leads = finite(evidence.leads);
  const qualified = finite(evidence.qualifiedLeads);
  const appointments = finite(evidence.appointments);
  const sales = finite(evidence.sales);
  const reasons: string[] = [];
  const gates = [
    spend / PERFORMANCE_GUARDS.minimumSpend,
    impressions / PERFORMANCE_GUARDS.minimumImpressions,
    leads / PERFORMANCE_GUARDS.minimumLeads,
    qualified / PERFORMANCE_GUARDS.minimumQualifiedLeads,
  ];
  const confidence = Math.min(1, Math.max(0, Math.min(...gates)));
  const eligibleForBoost = confidence >= 1 && (appointments >= PERFORMANCE_GUARDS.minimumAppointments || sales >= 1);
  if (!eligibleForBoost) reasons.push("Market prior retained until spend, impressions, lead quality, and business-outcome thresholds are met.");

  // Beta-binomial shrinkage keeps small samples near neutral. Qualified lead,
  // appointment and sale signals dominate; CTR/CPC are diagnostics only.
  const qualifiedRate = (qualified + 4) / (leads + 10);
  const appointmentRate = (appointments + 1) / (qualified + 6);
  const saleRate = (sales + 0.5) / (appointments + 4);
  const qualityComposite = qualifiedRate * 0.45 + appointmentRate * 0.35 + saleRate * 0.2;
  const centered = Math.max(-1, Math.min(1, (qualityComposite - 0.25) / 0.25));
  const recencyDate = evidence.lastSeenAt ? new Date(evidence.lastSeenAt) : new Date();
  const ageDays = Number.isFinite(recencyDate.getTime()) ? Math.max(0, (Date.now() - recencyDate.getTime()) / 86_400_000) : 365;
  const recency = Math.max(0.35, Math.exp(-ageDays / 120));
  const rawMultiplier = 1 + centered * 0.35 * confidence * recency;
  const multiplier = eligibleForBoost
    ? Math.min(PERFORMANCE_GUARDS.maximumBoost, Math.max(PERFORMANCE_GUARDS.maximumPenalty, rawMultiplier))
    : 1;
  const evidenceTier = sales >= PERFORMANCE_GUARDS.provenSales && eligibleForBoost ? "proven"
    : eligibleForBoost ? "qualified"
      : confidence >= 0.5 ? "developing" : "insufficient";
  return { multiplier: Number(multiplier.toFixed(4)), confidence: Number(confidence.toFixed(4)), eligibleForBoost, evidenceTier, reasons };
}
