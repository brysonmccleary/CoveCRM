import crypto from "crypto";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import MetaCAPIEvent from "@/models/MetaCAPIEvent";
import MetaCAPIDailyUsage from "@/models/MetaCAPIDailyUsage";
import { metaGraphUrl } from "@/lib/meta/graphApi";

export type MetaLifecycleEventName =
  | "LeadAccepted"
  | "Contacted"
  | "Qualified"
  | "AppointmentBooked"
  | "AppointmentShowed"
  | "Sale"
  | "PolicyIssued";

export function isCapiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.CAPI_ENABLED || "").toLowerCase() === "true";
}

const QUALITY_SIGNAL_EVENTS: MetaLifecycleEventName[] = [
  "Qualified",
  "AppointmentBooked",
  "AppointmentShowed",
  "Sale",
  "PolicyIssued",
];

export async function hasRecentMetaQualitySignal(userEmail: string, days = 30): Promise<boolean> {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  const event = await MetaCAPIEvent.findOne({
    userEmail: String(userEmail || "").trim().toLowerCase(),
    status: "sent",
    eventName: { $in: QUALITY_SIGNAL_EVENTS },
    sentAt: { $gte: since },
  }).select("_id").lean();
  return !!event;
}

export function sha256Normalized(value: unknown, kind: "email" | "phone" | "external"): string {
  let normalized = String(value || "").trim().toLowerCase();
  if (kind === "phone") {
    normalized = normalized.replace(/\D/g, "");
    if (normalized.length === 10) normalized = `1${normalized}`;
  }
  return normalized ? crypto.createHash("sha256").update(normalized).digest("hex") : "";
}

export function lifecycleEventId(leadEventId: string, eventName: MetaLifecycleEventName): string {
  if (!String(leadEventId || "").trim()) throw new Error("Stable lead event ID required for CAPI");
  return crypto.createHash("sha256").update(`${leadEventId}:${eventName}`).digest("hex");
}

export function buildMetaCapiEventPayload(input: {
  eventName: MetaLifecycleEventName;
  eventId: string;
  eventTime?: number;
  email?: string;
  phone?: string;
  externalId?: string;
  fbc?: string;
  fbp?: string;
  eventSourceUrl?: string;
  metaCampaignId?: string;
  metaAdId?: string;
  metaCreativeId?: string;
  creativeFamily?: string;
}) {
  const em = sha256Normalized(input.email, "email");
  const ph = sha256Normalized(input.phone, "phone");
  const externalId = sha256Normalized(input.externalId, "external");
  const userData: Record<string, any> = {};
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (externalId) userData.external_id = [externalId];
  if (input.fbc) userData.fbc = String(input.fbc).slice(0, 500);
  if (input.fbp) userData.fbp = String(input.fbp).slice(0, 500);

  return {
    event_name: input.eventName,
    event_time: input.eventTime || Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: "system_generated",
    ...(input.eventSourceUrl ? { event_source_url: String(input.eventSourceUrl).slice(0, 1000) } : {}),
    user_data: userData,
    custom_data: {
      ...(input.metaCampaignId ? { campaign_id: String(input.metaCampaignId) } : {}),
      ...(input.metaAdId ? { ad_id: String(input.metaAdId) } : {}),
      ...(input.metaCreativeId ? { creative_id: String(input.metaCreativeId) } : {}),
      ...(input.creativeFamily ? { creative_family: String(input.creativeFamily) } : {}),
    },
  };
}

async function claimDailyCall(userEmail: string, dailyCap: number): Promise<boolean> {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const usage = await MetaCAPIDailyUsage.findOneAndUpdate(
      {
        userEmail,
        date,
        $or: [{ count: { $lt: dailyCap } }, { count: { $exists: false } }],
      },
      { $inc: { count: 1 }, $setOnInsert: { userEmail, date } },
      { upsert: true, new: true }
    ).lean();
    return !!usage;
  } catch (error: any) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

export async function processMetaCapiEventById(
  eventRecordId: string,
  expectedUserEmail: string,
  fetchFn: typeof fetch = fetch
): Promise<{ status: string; error?: string }> {
  if (!isCapiEnabled()) return { status: "disabled" };
  await mongooseConnect();
  const claimToken = crypto.randomUUID();
  const now = new Date();
  const claimed = await MetaCAPIEvent.findOneAndUpdate(
    {
      _id: eventRecordId,
      userEmail: String(expectedUserEmail || "").toLowerCase(),
      status: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: now },
    },
    { $set: { status: "processing", claimToken, claimedAt: now } },
    { new: true }
  ).lean() as any;
  if (!claimed) return { status: "deduplicated" };

  const userEmail = String(claimed.userEmail || "").toLowerCase();
  const user = await User.findOne({ email: userEmail })
    .select("metaDatasetId metaCapiEnabled metaCapiDailyCap metaSystemUserToken metaAccessToken")
    .lean() as any;
  const datasetId = String(user?.metaDatasetId || "").trim();
  const accessToken = String(user?.metaSystemUserToken || user?.metaAccessToken || "").trim();
  if (!user?.metaCapiEnabled || !datasetId || datasetId !== String(claimed.datasetId) || !accessToken) {
    await MetaCAPIEvent.updateOne(
      { _id: claimed._id, userEmail, status: "processing", claimToken },
      { $set: { status: "failed", lastError: "Tenant CAPI configuration is incomplete" } }
    );
    return { status: "failed", error: "Tenant CAPI configuration is incomplete" };
  }

  const dailyCap = Math.max(1, Math.min(100000, Number(user.metaCapiDailyCap) || 1000));
  if (!(await claimDailyCall(userEmail, dailyCap))) {
    await MetaCAPIEvent.updateOne(
      { _id: claimed._id, userEmail, status: "processing", claimToken },
      { $set: { status: "capped", lastError: `Daily CAPI cap of ${dailyCap} reached` } }
    );
    return { status: "capped" };
  }

  try {
    const response = await fetchFn(metaGraphUrl(`${encodeURIComponent(datasetId)}/events`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [claimed.payload], access_token: accessToken }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error) throw new Error(body?.error?.message || `Meta CAPI HTTP ${response.status}`);
    await MetaCAPIEvent.updateOne(
      { _id: claimed._id, userEmail, status: "processing", claimToken },
      { $set: { status: "sent", sentAt: new Date(), lastError: "" }, $inc: { attempts: 1 } }
    );
    return { status: "sent" };
  } catch (error: any) {
    const attempts = Number(claimed.attempts || 0) + 1;
    const delayMs = Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(attempts - 1, 10));
    await MetaCAPIEvent.updateOne(
      { _id: claimed._id, userEmail, status: "processing", claimToken },
      {
        $set: {
          status: "failed",
          nextAttemptAt: new Date(Date.now() + delayMs),
          lastError: String(error?.message || "Meta CAPI request failed").slice(0, 1000),
        },
        $inc: { attempts: 1 },
      }
    );
    return { status: "failed", error: error?.message };
  }
}

export async function enqueueMetaLifecycleEvent(input: {
  userEmail: string;
  leadId: string;
  leadEventId: string;
  eventName: MetaLifecycleEventName;
  email?: string;
  phone?: string;
  fbc?: string;
  fbp?: string;
  eventSourceUrl?: string;
  metaCampaignId?: string;
  metaAdId?: string;
  metaCreativeId?: string;
  creativeFamily?: string;
}): Promise<{ status: string; eventId?: string }> {
  if (!isCapiEnabled()) return { status: "disabled" };
  await mongooseConnect();
  const userEmail = String(input.userEmail || "").trim().toLowerCase();
  const user = await User.findOne({ email: userEmail })
    .select("metaDatasetId metaCapiEnabled")
    .lean() as any;
  if (!user?.metaCapiEnabled || !String(user.metaDatasetId || "").trim()) return { status: "not_configured" };

  const eventId = lifecycleEventId(input.leadEventId, input.eventName);
  const payload = buildMetaCapiEventPayload({
    ...input,
    eventId,
    externalId: input.leadId,
  });
  const record = await MetaCAPIEvent.findOneAndUpdate(
    { userEmail, eventId, eventName: input.eventName },
    {
      $setOnInsert: {
        userEmail,
        datasetId: String(user.metaDatasetId),
        leadId: input.leadId,
        eventId,
        eventName: input.eventName,
        payload,
        status: "pending",
        nextAttemptAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).lean() as any;

  processMetaCapiEventById(String(record._id), userEmail).catch((error) => {
    console.warn("[meta-capi] background delivery failed:", error?.message);
  });
  return { status: record.status === "sent" ? "deduplicated" : "queued", eventId };
}

export function queueMetaLifecycleEventNonBlocking(
  input: Parameters<typeof enqueueMetaLifecycleEvent>[0],
  enqueue: typeof enqueueMetaLifecycleEvent = enqueueMetaLifecycleEvent,
  onError: (error: any) => void = (error) => console.warn("[meta-capi] queue failed:", error?.message)
): void {
  Promise.resolve().then(() => enqueue(input)).catch(onError);
}

export async function enqueueMetaLifecycleEventSafely(
  input: Parameters<typeof enqueueMetaLifecycleEvent>[0],
  enqueue: typeof enqueueMetaLifecycleEvent = enqueueMetaLifecycleEvent,
  onError: (error: any) => void = (error) => console.warn("[meta-capi] queue failed:", error?.message)
): Promise<{ status: string; eventId?: string }> {
  try {
    return await enqueue(input);
  } catch (error: any) {
    onError(error);
    return { status: "queue_failed" };
  }
}

export async function processPendingMetaCapiEvents(limit = 50): Promise<{
  processed: number;
  results: Array<{ status: string; error?: string }>;
}> {
  if (!isCapiEnabled()) return { processed: 0, results: [] };
  await mongooseConnect();
  const tenants = await User.find({ metaCapiEnabled: true, metaDatasetId: { $ne: "" } })
    .select("email")
    .lean() as any[];
  const results = [];
  const cappedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  let processed = 0;
  for (const tenant of tenants) {
    if (processed >= cappedLimit) break;
    const userEmail = String(tenant.email || "").toLowerCase();
    const rows = await MetaCAPIEvent.find({
      userEmail,
      status: { $in: ["pending", "failed"] },
      nextAttemptAt: { $lte: new Date() },
    })
      .select("_id")
      .sort({ nextAttemptAt: 1 })
      .limit(cappedLimit - processed)
      .lean() as any[];
    for (const row of rows) results.push(await processMetaCapiEventById(String(row._id), userEmail));
    processed += rows.length;
  }
  return { processed, results };
}
