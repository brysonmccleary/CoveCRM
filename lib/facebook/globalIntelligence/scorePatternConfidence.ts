export type PatternStatus = "learning" | "promising" | "winner" | "fatigued" | "paused" | "archived";

export function clampScore(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function scorePatternConfidence(input: {
  totalCampaigns: number;
  totalSpend: number;
  totalLeads: number;
  totalAppointments: number;
  totalSales: number;
  avgCpl: number;
  avgCostPerAppointment: number;
  avgCostPerSale: number;
  avgContactRate: number;
  avgCloseRate: number;
  avgAppointmentRate: number;
  avgOptOutRate: number;
  avgBadNumberRate: number;
  avgFrequency: number;
  lastSeenAt?: Date | string | null;
  hasFatigue?: boolean;
}): {
  performanceScore: number;
  confidenceScore: number;
  sampleSizeScore: number;
  status: PatternStatus;
} {
  const leads = Number(input.totalLeads || 0);
  const spend = Number(input.totalSpend || 0);
  const appointments = Number(input.totalAppointments || 0);
  const sales = Number(input.totalSales || 0);
  const campaigns = Number(input.totalCampaigns || 0);

  const sampleSizeScore = clampScore(
    Math.log10(1 + leads) * 28 + Math.log10(1 + spend) * 16 + campaigns * 6 + appointments * 8 + sales * 14
  );

  const leadEfficiency =
    input.avgCpl > 0 ? clampScore(100 - Math.min(85, input.avgCpl * 2.2)) : leads > 0 ? 45 : 0;
  const appointmentEfficiency =
    appointments > 0 && input.avgCostPerAppointment > 0
      ? clampScore(115 - Math.min(95, input.avgCostPerAppointment * 0.45))
      : 35;
  const salesEfficiency =
    sales > 0 && input.avgCostPerSale > 0
      ? clampScore(125 - Math.min(100, input.avgCostPerSale * 0.18))
      : 40;

  const outcomeLift = clampScore(
    input.avgAppointmentRate * 180 + input.avgCloseRate * 130 + input.avgContactRate * 55
  );
  const qualityPenalty = clampScore(
    input.avgOptOutRate * 1.6 + input.avgBadNumberRate * 1.4 + Math.max(0, input.avgFrequency - 2.8) * 12,
    0,
    55
  );
  const fatiguePenalty = input.hasFatigue || input.avgFrequency >= 4 ? 14 : 0;

  const rawPerformance =
    leadEfficiency * 0.22 +
    appointmentEfficiency * 0.24 +
    salesEfficiency * 0.26 +
    outcomeLift * 0.28 -
    qualityPenalty -
    fatiguePenalty;

  const confidenceScore = clampScore(sampleSizeScore * 0.72 + Math.min(28, campaigns * 7));
  const performanceScore = Number(clampScore(rawPerformance * (0.55 + confidenceScore / 220)).toFixed(2));

  let status: PatternStatus = "learning";
  if (leads >= 8 || appointments >= 2 || sales >= 1) status = "promising";
  if (confidenceScore >= 45 && performanceScore >= 62 && (leads >= 8 || appointments >= 2 || sales >= 1)) {
    status = "winner";
  }
  if (input.hasFatigue || input.avgFrequency >= 4.5 || input.avgOptOutRate >= 18 || input.avgBadNumberRate >= 22) {
    status = performanceScore >= 58 && confidenceScore >= 35 ? "fatigued" : "paused";
  }
  if (leads < 1 && spend < 10) status = "learning";

  return {
    performanceScore,
    confidenceScore: Number(confidenceScore.toFixed(2)),
    sampleSizeScore: Number(sampleSizeScore.toFixed(2)),
    status,
  };
}
