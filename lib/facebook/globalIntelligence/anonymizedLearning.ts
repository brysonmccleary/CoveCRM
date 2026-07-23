import FBGlobalAdPattern from "@/models/FBGlobalAdPattern";
import mongooseConnect from "@/lib/mongooseConnect";

export const GLOBAL_LEARNING_ATTRIBUTION_CUTOFF = new Date(
  process.env.META_ATTRIBUTION_V1_CUTOFF || "2026-07-14T00:00:00.000Z"
);

export type AnonymizedPerformanceRow = {
  leadType: string;
  stateCode: string;
  creativeFamily: string;
  spend: number;
  leads: number;
  appointments: number;
  sales: number;
  costPerLead: number;
  costPerAppointment: number;
  costPerSale: number;
};

function finite(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function isPostAttributionFixLaunch(campaign: Record<string, any>): boolean {
  const published = new Date(campaign.metaLastPublishSuccessAt || 0);
  return campaign.attributionVersion === "signed-v1" &&
    Number.isFinite(published.getTime()) &&
    published >= GLOBAL_LEARNING_ATTRIBUTION_CUTOFF;
}

export function anonymizeCampaignPerformance(campaign: Record<string, any>): AnonymizedPerformanceRow[] {
  if (!isPostAttributionFixLaunch(campaign)) return [];
  const states = Array.from(new Set((Array.isArray(campaign.licensedStates) ? campaign.licensedStates : [])
    .map((state: any) => String(state || "").toUpperCase()).filter(Boolean)));
  const ads = Array.isArray(campaign.ads) && campaign.ads.length
    ? campaign.ads
    : [{
        creativeFamily: campaign.winningFamilyId || "unknown",
        spend: campaign.totalSpend,
        leads: campaign.totalLeads,
        appointmentsBooked: campaign.appointments,
        sales: campaign.sales,
      }];
  const rows: AnonymizedPerformanceRow[] = [];
  for (const ad of ads) {
    const spend = finite(ad.spend);
    const leads = finite(ad.leads);
    const appointments = finite(ad.appointmentsBooked);
    const sales = finite(ad.sales);
    for (const stateCode of states) rows.push({
      leadType: String(campaign.leadType || ""),
      stateCode,
      creativeFamily: String(ad.creativeFamily || ad.variantId || "unknown"),
      spend,
      leads,
      appointments,
      sales,
      costPerLead: leads > 0 ? spend / leads : 0,
      costPerAppointment: appointments > 0 ? spend / appointments : 0,
      costPerSale: sales > 0 ? spend / sales : 0,
    });
  }
  return rows.filter((row) => row.leadType && row.stateCode && row.creativeFamily);
}

export function compareGlobalWinners(a: AnonymizedPerformanceRow, b: AnonymizedPerformanceRow): number {
  const tier = (row: AnonymizedPerformanceRow) => row.sales > 0 ? 3 : row.appointments > 0 ? 2 : row.leads > 0 ? 1 : 0;
  const tierDifference = tier(b) - tier(a);
  if (tierDifference) return tierDifference;
  if (a.sales > 0 && b.sales > 0 && a.costPerSale !== b.costPerSale) return a.costPerSale - b.costPerSale;
  if (a.appointments > 0 && b.appointments > 0 && a.costPerAppointment !== b.costPerAppointment) {
    return a.costPerAppointment - b.costPerAppointment;
  }
  if (a.costPerLead && b.costPerLead && a.costPerLead !== b.costPerLead) return a.costPerLead - b.costPerLead;
  return b.sales - a.sales || b.appointments - a.appointments || b.leads - a.leads;
}

export type GlobalGenerationHint = {
  creativeFamily: string;
  leadType: string;
  stateCode: string;
  rankBasis: "sale" | "appointment" | "lead";
};

export async function loadGlobalGenerationHints(input: {
  leadType: string;
  stateCodes?: string[];
  limit?: number;
}): Promise<GlobalGenerationHint[]> {
  await mongooseConnect();
  const states = (input.stateCodes || []).map((state) => String(state).toUpperCase()).filter(Boolean);
  const query: Record<string, any> = {
    leadType: input.leadType,
    status: { $in: ["winner", "promising"] },
    totalCampaigns: { $gt: 0 },
  };
  if (states.length) query.stateCode = { $in: states };
  const patterns = await FBGlobalAdPattern.find(query)
    .select("leadType stateCode winningFamilyId totalSpend totalLeads totalAppointments totalSales avgCpl avgCostPerAppointment avgCostPerSale")
    .limit(Math.max(1, Math.min(20, input.limit || 8)))
    .lean() as any[];
  return patterns.map((pattern) => ({
    creativeFamily: String(pattern.winningFamilyId || ""),
    leadType: String(pattern.leadType || ""),
    stateCode: String(pattern.stateCode || ""),
    rankBasis: pattern.totalSales > 0 ? "sale" as const : pattern.totalAppointments > 0 ? "appointment" as const : "lead" as const,
    _rank: {
      leadType: String(pattern.leadType || ""), stateCode: String(pattern.stateCode || ""),
      creativeFamily: String(pattern.winningFamilyId || ""), spend: finite(pattern.totalSpend),
      leads: finite(pattern.totalLeads), appointments: finite(pattern.totalAppointments), sales: finite(pattern.totalSales),
      costPerLead: finite(pattern.avgCpl), costPerAppointment: finite(pattern.avgCostPerAppointment), costPerSale: finite(pattern.avgCostPerSale),
    },
  })).sort((a: any, b: any) => compareGlobalWinners(a._rank, b._rank))
    .map(({ _rank, ...hint }: any) => hint)
    .filter((hint: GlobalGenerationHint) => hint.creativeFamily);
}

export function applyGlobalWinnerHints<T extends { familyId?: string }>(variants: T[], hints: GlobalGenerationHint[]): T[] {
  const ranks = new Map(hints.map((hint, index) => [hint.creativeFamily, index]));
  return [...variants].sort((a, b) =>
    (ranks.get(String(a.familyId || "")) ?? Number.MAX_SAFE_INTEGER) -
    (ranks.get(String(b.familyId || "")) ?? Number.MAX_SAFE_INTEGER)
  );
}
