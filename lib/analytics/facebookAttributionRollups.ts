import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import LeadOutcomeEvent from "@/models/LeadOutcomeEvent";
import AdMetricsDaily from "@/models/AdMetricsDaily";
import { getAttributionConfidence, AttributionConfidence } from "@/lib/analytics/attributionConfidence";

type MetricBucket = {
  key: string;
  state?: string;
  leadType?: string;
  campaignId?: string;
  metaCampaignId?: string;
  metaAdsetId?: string;
  metaAdId?: string;
  metaCreativeId?: string;
  visualVariantIndex?: number | null;
  creativeArchetype?: string;
  variationType?: string;
  leads: number;
  bookedAppointments: number;
  noShows: number;
  sold: number;
  notInterested: number;
  badNumber: number;
  optOut: number;
  contactConnected: number;
  spend: number;
  firstSeenAt?: Date | null;
  bookedRate: number;
  noShowRate: number;
  soldRate: number;
  badNumberRate: number;
  dncRate: number;
  costPerBooked: number;
  costPerSale: number;
  confidence: AttributionConfidence;
};

function clean(value: unknown): string {
  return String(value || "").trim();
}

function stateOf(lead: any): string {
  return clean(lead?.state || lead?.State || lead?.STATE).toUpperCase() || "UNKNOWN";
}

function leadTypeOf(lead: any): string {
  return clean(lead?.leadType || lead?.LeadType || lead?.["Lead Type"] || "unknown").toLowerCase() || "unknown";
}

function firstDate(a?: Date | null, b?: unknown): Date | null {
  const bd = b ? new Date(String(b)) : null;
  if (!bd || Number.isNaN(bd.getTime())) return a || null;
  if (!a) return bd;
  return bd < a ? bd : a;
}

function daysSince(date?: Date | null): number {
  if (!date) return 0;
  return Math.max(0, Math.ceil((Date.now() - date.getTime()) / 86400000));
}

function emptyBucket(key: string, fields: Partial<MetricBucket>): MetricBucket {
  return {
    key,
    leads: 0,
    bookedAppointments: 0,
    noShows: 0,
    sold: 0,
    notInterested: 0,
    badNumber: 0,
    optOut: 0,
    contactConnected: 0,
    spend: 0,
    firstSeenAt: null,
    bookedRate: 0,
    noShowRate: 0,
    soldRate: 0,
    badNumberRate: 0,
    dncRate: 0,
    costPerBooked: 0,
    costPerSale: 0,
    confidence: "insufficient_data",
    ...fields,
  };
}

function bumpOutcome(bucket: MetricBucket, outcome: string) {
  if (outcome === "appointment_booked" || outcome === "booked_appointment") bucket.bookedAppointments += 1;
  else if (outcome === "no_show") bucket.noShows += 1;
  else if (outcome === "sale" || outcome === "sold") bucket.sold += 1;
  else if (outcome === "not_interested") bucket.notInterested += 1;
  else if (outcome === "bad_number") bucket.badNumber += 1;
  else if (outcome === "opt_out" || outcome === "do_not_contact") bucket.optOut += 1;
  else if (outcome === "call_connected" || outcome === "transfer_success") bucket.contactConnected += 1;
}

function finalize(bucket: MetricBucket): MetricBucket {
  const leads = bucket.leads || 0;
  bucket.bookedRate = leads ? bucket.bookedAppointments / leads : 0;
  bucket.noShowRate = bucket.bookedAppointments ? bucket.noShows / bucket.bookedAppointments : 0;
  bucket.soldRate = leads ? bucket.sold / leads : 0;
  bucket.badNumberRate = leads ? bucket.badNumber / leads : 0;
  bucket.dncRate = leads ? bucket.optOut / leads : 0;
  bucket.costPerBooked = bucket.bookedAppointments && bucket.spend ? bucket.spend / bucket.bookedAppointments : 0;
  bucket.costPerSale = bucket.sold && bucket.spend ? bucket.spend / bucket.sold : 0;
  bucket.confidence = getAttributionConfidence({
    leads,
    spend: bucket.spend,
    daysRunning: daysSince(bucket.firstSeenAt),
    bookedAppointments: bucket.bookedAppointments,
    sold: bucket.sold,
  });
  return bucket;
}

function leadMeta(lead: any, event?: any) {
  return {
    state: stateOf(lead),
    leadType: leadTypeOf(lead),
    campaignId: clean(event?.campaignId || lead?.campaignId || lead?.sourceCampaignId || lead?.facebookCampaignId),
    metaCampaignId: clean(event?.metaCampaignId || lead?.metaCampaignId),
    metaAdsetId: clean(event?.metaAdsetId || lead?.metaAdsetId),
    metaAdId: clean(event?.metaAdId || lead?.metaAdId),
    metaCreativeId: clean(event?.metaCreativeId || lead?.metaCreativeId || lead?.creativeId),
    visualVariantIndex: Number.isFinite(Number(event?.visualVariantIndex ?? lead?.visualVariantIndex))
      ? Number(event?.visualVariantIndex ?? lead?.visualVariantIndex)
      : null,
    creativeArchetype: clean(event?.creativeArchetype || lead?.creativeArchetype),
    variationType: clean(event?.variationType || lead?.variationType),
  };
}

function key(parts: unknown[]) {
  return parts.map((part) => clean(part) || "unknown").join("|");
}

function addTo(map: Map<string, MetricBucket>, bucketKey: string, fields: Partial<MetricBucket>, lead?: any, event?: any) {
  const bucket = map.get(bucketKey) || emptyBucket(bucketKey, fields);
  if (lead && !event) {
    bucket.leads += 1;
    bucket.firstSeenAt = firstDate(bucket.firstSeenAt, lead.createdAt);
  }
  if (event) {
    bumpOutcome(bucket, clean(event.outcomeType || event.normalizedDisposition));
    bucket.firstSeenAt = firstDate(bucket.firstSeenAt, lead?.createdAt || event.occurredAt);
  }
  map.set(bucketKey, bucket);
}

export async function buildFacebookAttributionRollups(userEmail: string) {
  await mongooseConnect();
  const email = userEmail.toLowerCase();

  const leads = await Lead.find({
    userEmail: email,
    $or: [
      { metaCampaignId: { $exists: true, $ne: "" } },
      { metaAdId: { $exists: true, $ne: "" } },
      { campaignId: { $exists: true, $ne: null } },
      { sourceType: { $in: ["facebook_lead", "facebook_funnel"] } },
    ],
  })
    .select("_id createdAt state State leadType campaignId sourceCampaignId facebookCampaignId metaCampaignId metaAdsetId metaAdId metaCreativeId creativeId visualVariantIndex creativeArchetype variationType")
    .lean() as any[];

  const leadById = new Map(leads.map((lead: any) => [String(lead._id), lead]));
  const events = await LeadOutcomeEvent.find({ userEmail: email }).lean() as any[];
  for (const event of events) {
    const leadId = String(event.leadId || "");
    if (!leadById.has(leadId)) {
      const lead = await Lead.findOne({ _id: leadId, userEmail: email })
        .select("_id createdAt state State leadType campaignId sourceCampaignId facebookCampaignId metaCampaignId metaAdsetId metaAdId metaCreativeId creativeId visualVariantIndex creativeArchetype variationType")
        .lean();
      if (lead) leadById.set(leadId, lead);
    }
  }

  const spendRows = await AdMetricsDaily.find({ userEmail: email }).select("campaignId spend date").lean() as any[];
  const spendByCampaign = new Map<string, { spend: number; firstDate: Date | null }>();
  for (const row of spendRows) {
    const cid = clean(row.campaignId);
    if (!cid) continue;
    const prev = spendByCampaign.get(cid) || { spend: 0, firstDate: null };
    prev.spend += Number(row.spend || 0);
    prev.firstDate = firstDate(prev.firstDate, row.date ? `${row.date}T00:00:00Z` : null);
    spendByCampaign.set(cid, prev);
  }

  const maps = {
    byState: new Map<string, MetricBucket>(),
    byLeadType: new Map<string, MetricBucket>(),
    byCampaign: new Map<string, MetricBucket>(),
    byAdset: new Map<string, MetricBucket>(),
    byAd: new Map<string, MetricBucket>(),
    byCreative: new Map<string, MetricBucket>(),
    byVisualVariant: new Map<string, MetricBucket>(),
    byCreativeArchetype: new Map<string, MetricBucket>(),
    byVariationType: new Map<string, MetricBucket>(),
  };

  for (const lead of leads) {
    const meta = leadMeta(lead);
    const campaignKey = meta.campaignId || meta.metaCampaignId;
    addTo(maps.byState, key([meta.state, meta.leadType, meta.campaignId, meta.metaCampaignId, meta.metaAdsetId, meta.metaAdId, meta.metaCreativeId]), meta, lead);
    addTo(maps.byLeadType, key([campaignKey, meta.leadType]), meta, lead);
    if (meta.campaignId || meta.metaCampaignId) addTo(maps.byCampaign, key([meta.campaignId || meta.metaCampaignId]), meta, lead);
    if (meta.metaAdsetId) addTo(maps.byAdset, key([meta.metaAdsetId]), meta, lead);
    if (meta.metaAdId) addTo(maps.byAd, key([meta.metaAdId]), meta, lead);
    if (meta.metaCreativeId) addTo(maps.byCreative, key([campaignKey, meta.metaCreativeId]), meta, lead);
    if (meta.visualVariantIndex !== null) addTo(maps.byVisualVariant, key([campaignKey, meta.visualVariantIndex]), meta, lead);
    if (meta.creativeArchetype) addTo(maps.byCreativeArchetype, key([campaignKey, meta.creativeArchetype]), meta, lead);
    if (meta.variationType) addTo(maps.byVariationType, key([campaignKey, meta.variationType]), meta, lead);
  }

  for (const event of events) {
    const lead = leadById.get(String(event.leadId || ""));
    if (!lead) continue;
    const meta = leadMeta(lead, event);
    const campaignKey = meta.campaignId || meta.metaCampaignId;
    addTo(maps.byState, key([meta.state, meta.leadType, meta.campaignId, meta.metaCampaignId, meta.metaAdsetId, meta.metaAdId, meta.metaCreativeId]), meta, lead, event);
    addTo(maps.byLeadType, key([campaignKey, meta.leadType]), meta, lead, event);
    if (meta.campaignId || meta.metaCampaignId) addTo(maps.byCampaign, key([meta.campaignId || meta.metaCampaignId]), meta, lead, event);
    if (meta.metaAdsetId) addTo(maps.byAdset, key([meta.metaAdsetId]), meta, lead, event);
    if (meta.metaAdId) addTo(maps.byAd, key([meta.metaAdId]), meta, lead, event);
    if (meta.metaCreativeId) addTo(maps.byCreative, key([campaignKey, meta.metaCreativeId]), meta, lead, event);
    if (meta.visualVariantIndex !== null) addTo(maps.byVisualVariant, key([campaignKey, meta.visualVariantIndex]), meta, lead, event);
    if (meta.creativeArchetype) addTo(maps.byCreativeArchetype, key([campaignKey, meta.creativeArchetype]), meta, lead, event);
    if (meta.variationType) addTo(maps.byVariationType, key([campaignKey, meta.variationType]), meta, lead, event);
  }

  for (const bucket of maps.byCampaign.values()) {
    const spend = spendByCampaign.get(clean(bucket.campaignId || bucket.key));
    if (spend) {
      bucket.spend = spend.spend;
      bucket.firstSeenAt = firstDate(bucket.firstSeenAt, spend.firstDate);
    }
  }

  const toArray = (map: Map<string, MetricBucket>) =>
    Array.from(map.values()).map(finalize).sort((a, b) => b.leads - a.leads || b.bookedAppointments - a.bookedAppointments);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    rollups: {
      byState: toArray(maps.byState),
      byLeadType: toArray(maps.byLeadType),
      byCampaign: toArray(maps.byCampaign),
      byAdset: toArray(maps.byAdset),
      byAd: toArray(maps.byAd),
      byCreative: toArray(maps.byCreative),
      byVisualVariant: toArray(maps.byVisualVariant),
      byCreativeArchetype: toArray(maps.byCreativeArchetype),
      byVariationType: toArray(maps.byVariationType),
    },
  };
}
