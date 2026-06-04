import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";

const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";
const HEALTH_CACHE_MS = 6 * 60 * 60 * 1000;
const HEALTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export type MetaHealthStatus =
  | "unknown"
  | "healthy"
  | "reconnectNeeded"
  | "accountDisabled"
  | "missingPaymentMethod"
  | "missingPagePermission"
  | "missingLeadAdsEligibility"
  | "missingPage"
  | "missingAdAccount"
  | "cooldown"
  | "error";

export type MetaHealthResult = {
  ok: boolean;
  status: MetaHealthStatus;
  reason: string;
  fixUrl?: string;
  cooldownUntil?: Date | null;
  checkedAt: Date;
  lastSuccessfulHealthCheckAt?: Date | null;
  account?: Record<string, any>;
  page?: Record<string, any>;
};

type HealthInput = {
  user?: any;
  userId?: string;
  userEmail?: string;
  accessToken?: string;
  pageId?: string;
  adAccountId?: string;
  requireRecentSuccess?: boolean;
  force?: boolean;
};

const BLOCKING_STATUSES = new Set<MetaHealthStatus>([
  "reconnectNeeded",
  "accountDisabled",
  "missingPaymentMethod",
  "missingPagePermission",
  "missingLeadAdsEligibility",
  "missingPage",
  "missingAdAccount",
  "cooldown",
]);

function normalizeAdAccountId(id: string) {
  return String(id || "").trim().replace(/^act_/, "");
}

function errorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function classifyMetaHealthError(error: unknown): {
  status: MetaHealthStatus;
  reconnectNeeded: boolean;
  cooldown: boolean;
  reason: string;
  fixUrl?: string;
} {
  const raw = errorText(error);
  const text = raw.toLowerCase();
  const codeMatch = raw.match(/"code"\s*:\s*(\d+)|\bcode[:=]\s*(\d+)/i);
  const code = codeMatch ? String(codeMatch[1] || codeMatch[2] || "") : "";

  if (
    code === "190" ||
    text.includes("oauth") ||
    text.includes("access token") ||
    text.includes("session has expired") ||
    text.includes("invalid token")
  ) {
    return {
      status: "reconnectNeeded",
      reconnectNeeded: true,
      cooldown: true,
      reason: "Facebook needs you to reconnect your account.",
      fixUrl: "/api/meta/connect",
    };
  }

  if (text.includes("permission") || text.includes("permissions") || code === "200" || code === "10") {
    return {
      status: "reconnectNeeded",
      reconnectNeeded: true,
      cooldown: true,
      reason: "Facebook needs you to reconnect and approve ad permissions.",
      fixUrl: "/api/meta/connect",
    };
  }

  if (code === "1359188" || text.includes("payment method") || text.includes("billing")) {
    return {
      status: "missingPaymentMethod",
      reconnectNeeded: false,
      cooldown: true,
      reason: "Add a payment method in Facebook before launching ads.",
      fixUrl: "https://business.facebook.com/billing",
    };
  }

  if (text.includes("lead ads terms") || text.includes("leadgen") || text.includes("lead ads tos")) {
    return {
      status: "missingLeadAdsEligibility",
      reconnectNeeded: false,
      cooldown: true,
      reason: "Accept Facebook Lead Ads Terms before launching lead ads.",
      fixUrl: "https://www.facebook.com/ads/leadgen/tos",
    };
  }

  if (text.includes("ad account") && (text.includes("disabled") || text.includes("closed"))) {
    return {
      status: "accountDisabled",
      reconnectNeeded: false,
      cooldown: true,
      reason: "The selected Facebook ad account is disabled or unavailable.",
      fixUrl: "https://business.facebook.com/accountquality",
    };
  }

  return {
    status: "error",
    reconnectNeeded: false,
    cooldown: false,
    reason: raw.slice(0, 500) || "Facebook setup check failed.",
  };
}

function fixUrlForStatus(status: MetaHealthStatus) {
  if (status === "reconnectNeeded") return "/api/meta/connect";
  if (status === "missingPaymentMethod") return "https://business.facebook.com/billing";
  if (status === "missingLeadAdsEligibility") return "https://www.facebook.com/ads/leadgen/tos";
  if (status === "accountDisabled") return "https://business.facebook.com/accountquality";
  if (status === "missingPage") return "https://www.facebook.com/pages/create";
  return undefined;
}

async function updateUserHealth(user: any, update: Record<string, any>) {
  await mongooseConnect();
  const query = user?._id ? { _id: user._id } : { email: String(user?.email || "").toLowerCase() };
  if (!query._id && !query.email) return;
  await User.updateOne(query, { $set: update }).catch(() => {});
}

export async function markMetaHealthFailure(params: {
  user?: any;
  userId?: string;
  userEmail?: string;
  error: unknown;
  cooldownMs?: number;
}) {
  await mongooseConnect();
  const classified = classifyMetaHealthError(params.error);
  const now = new Date();
  const cooldownUntil = classified.cooldown
    ? new Date(now.getTime() + (params.cooldownMs || HEALTH_COOLDOWN_MS))
    : null;
  const update = {
    metaReconnectNeeded: classified.reconnectNeeded,
    metaHealthStatus: classified.status,
    lastMetaHealthError: classified.reason,
    metaHealthCooldownUntil: cooldownUntil,
    metaLastHealthCheckAt: now,
  };
  const query = params.user?._id
    ? { _id: params.user._id }
    : params.userId
      ? { _id: params.userId }
      : { email: String(params.userEmail || params.user?.email || "").toLowerCase() };
  await User.updateOne(query, { $set: update }).catch(() => {});
  if (params.userEmail || params.user?.email) {
    await FBLeadCampaign.updateMany(
      { userEmail: String(params.userEmail || params.user?.email || "").toLowerCase() },
      {
        $set: {
          metaSyncStatus: classified.status === "reconnectNeeded" ? "token_expired" : "sync_failed",
          metaObjectHealth: classified.status === "reconnectNeeded" ? "token_expired" : "sync_failed",
          metaSyncError: classified.reason,
        },
      }
    ).catch(() => {});
  }
  return { ...classified, cooldownUntil };
}

function cachedHealth(user: any, now: Date): MetaHealthResult | null {
  const status = String(user?.metaHealthStatus || "unknown") as MetaHealthStatus;
  const cooldownUntil = user?.metaHealthCooldownUntil ? new Date(user.metaHealthCooldownUntil) : null;
  if (cooldownUntil && cooldownUntil > now) {
    return {
      ok: false,
      status: "cooldown",
      reason: String(user?.lastMetaHealthError || "Facebook setup needs attention before trying again."),
      fixUrl: fixUrlForStatus(status),
      cooldownUntil,
      checkedAt: now,
      lastSuccessfulHealthCheckAt: user?.metaLastSuccessfulHealthCheckAt || null,
    };
  }
  if (user?.metaReconnectNeeded || BLOCKING_STATUSES.has(status)) {
    return {
      ok: false,
      status,
      reason: String(user?.lastMetaHealthError || "Facebook setup needs attention before launching ads."),
      fixUrl: fixUrlForStatus(status),
      cooldownUntil,
      checkedAt: now,
      lastSuccessfulHealthCheckAt: user?.metaLastSuccessfulHealthCheckAt || null,
    };
  }
  const lastSuccess = user?.metaLastSuccessfulHealthCheckAt
    ? new Date(user.metaLastSuccessfulHealthCheckAt)
    : null;
  if (status === "healthy" && lastSuccess && now.getTime() - lastSuccess.getTime() < HEALTH_CACHE_MS) {
    return {
      ok: true,
      status: "healthy",
      reason: "Facebook setup is ready.",
      checkedAt: now,
      lastSuccessfulHealthCheckAt: lastSuccess,
    };
  }
  return null;
}

async function graphGet(path: string, accessToken: string, fields?: string) {
  const url = new URL(`${META_GRAPH_BASE}/${path.replace(/^\//, "")}`);
  url.searchParams.set("access_token", accessToken);
  if (fields) url.searchParams.set("fields", fields);
  const resp = await fetch(url.toString());
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err: any = new Error(json?.error?.message || `Meta API error ${resp.status}`);
    err.meta = json;
    err.status = resp.status;
    throw err;
  }
  return json;
}

export async function checkMetaWriteReadiness(input: HealthInput): Promise<MetaHealthResult> {
  await mongooseConnect();
  const now = new Date();
  const user = input.user || (input.userId
    ? await User.findById(input.userId).lean()
    : await User.findOne({ email: String(input.userEmail || "").toLowerCase() }).lean());

  const accessToken = String(input.accessToken || user?.metaSystemUserToken || user?.metaAccessToken || "").trim();
  const pageId = String(input.pageId || user?.metaPageId || "").trim();
  const adAccountId = normalizeAdAccountId(String(input.adAccountId || user?.metaAdAccountId || ""));

  if (!accessToken) {
    const result: MetaHealthResult = {
      ok: false,
      status: "reconnectNeeded",
      reason: "Reconnect Facebook before launching ads.",
      fixUrl: "/api/meta/connect",
      checkedAt: now,
    };
    await updateUserHealth(user, {
      metaReconnectNeeded: true,
      metaHealthStatus: result.status,
      lastMetaHealthError: result.reason,
      metaHealthCooldownUntil: new Date(now.getTime() + HEALTH_COOLDOWN_MS),
      metaLastHealthCheckAt: now,
    });
    return result;
  }
  if (!pageId) {
    return {
      ok: false,
      status: "missingPage",
      reason: "Choose a Facebook Page before launching ads.",
      fixUrl: "https://www.facebook.com/pages/create",
      checkedAt: now,
    };
  }
  if (!adAccountId) {
    return {
      ok: false,
      status: "missingAdAccount",
      reason: "Choose the Facebook ad account that will run this campaign.",
      checkedAt: now,
    };
  }

  if (!input.force) {
    const cached = cachedHealth(user, now);
    if (cached) return cached;
  }

  try {
    const pages = await graphGet(
      "me/accounts",
      accessToken,
      "id,name,tasks,category,link,picture.type(large){url}"
    );
    const page = (Array.isArray(pages?.data) ? pages.data : []).find((p: any) => String(p?.id || "") === pageId);
    if (!page) {
      const result: MetaHealthResult = {
        ok: false,
        status: "missingPagePermission",
        reason: "Choose a Facebook Page you have permission to advertise from.",
        fixUrl: "/api/meta/connect",
        checkedAt: now,
      };
      await updateUserHealth(user, {
        metaReconnectNeeded: false,
        metaHealthStatus: result.status,
        lastMetaHealthError: result.reason,
        metaHealthCooldownUntil: new Date(now.getTime() + HEALTH_COOLDOWN_MS),
        metaLastHealthCheckAt: now,
      });
      return result;
    }

    const tasks = Array.isArray(page?.tasks) ? page.tasks.map((task: any) => String(task || "").toUpperCase()) : [];
    if (tasks.length && !tasks.includes("ADVERTISE")) {
      const result: MetaHealthResult = {
        ok: false,
        status: "missingPagePermission",
        reason: "Your Facebook Page needs ad permission before CoveCRM can launch ads from it.",
        fixUrl: "/api/meta/connect",
        checkedAt: now,
      };
      await updateUserHealth(user, {
        metaReconnectNeeded: false,
        metaHealthStatus: result.status,
        lastMetaHealthError: result.reason,
        metaHealthCooldownUntil: new Date(now.getTime() + HEALTH_COOLDOWN_MS),
        metaLastHealthCheckAt: now,
      });
      return result;
    }

    const adAccounts = await graphGet(
      "me/adaccounts",
      accessToken,
      "id,name,account_id,account_status,disable_reason,currency,timezone_name,amount_spent,balance"
    );
    const accountFromList = (Array.isArray(adAccounts?.data) ? adAccounts.data : []).find((account: any) => {
      const raw = String(account?.account_id || account?.id || "").replace(/^act_/, "");
      return raw === adAccountId;
    });
    if (!accountFromList) {
      const result: MetaHealthResult = {
        ok: false,
        status: "missingAdAccount",
        reason: "Choose a Facebook ad account you have access to.",
        checkedAt: now,
      };
      await updateUserHealth(user, {
        metaReconnectNeeded: false,
        metaHealthStatus: result.status,
        lastMetaHealthError: result.reason,
        metaHealthCooldownUntil: new Date(now.getTime() + HEALTH_COOLDOWN_MS),
        metaLastHealthCheckAt: now,
      });
      return result;
    }

    const account = await graphGet(
      `act_${adAccountId}`,
      accessToken,
      "account_status,disable_reason,currency,timezone_name,amount_spent,balance"
    );
    const statusCode = Number(account?.account_status ?? accountFromList?.account_status ?? 0);
    const disableReason = Number(account?.disable_reason ?? accountFromList?.disable_reason ?? 0);
    if ((statusCode && statusCode !== 1) || disableReason > 0) {
      const result: MetaHealthResult = {
        ok: false,
        status: "accountDisabled",
        reason: "The selected Facebook ad account is disabled or unavailable.",
        fixUrl: "https://business.facebook.com/accountquality",
        checkedAt: now,
        account,
        page,
      };
      await updateUserHealth(user, {
        metaReconnectNeeded: false,
        metaHealthStatus: result.status,
        lastMetaHealthError: result.reason,
        metaHealthCooldownUntil: new Date(now.getTime() + HEALTH_COOLDOWN_MS),
        metaLastHealthCheckAt: now,
      });
      return result;
    }

    const update = {
      metaReconnectNeeded: false,
      metaHealthStatus: "healthy",
      lastMetaHealthError: "",
      metaHealthCooldownUntil: null,
      metaLastHealthCheckAt: now,
      metaLastSuccessfulHealthCheckAt: now,
    };
    await updateUserHealth(user, update);
    return {
      ok: true,
      status: "healthy",
      reason: "Facebook setup is ready.",
      checkedAt: now,
      lastSuccessfulHealthCheckAt: now,
      account,
      page,
    };
  } catch (err) {
    const marked = await markMetaHealthFailure({
      user,
      userEmail: input.userEmail,
      error: err,
    });
    return {
      ok: false,
      status: marked.status,
      reason: marked.reason,
      fixUrl: marked.fixUrl,
      cooldownUntil: marked.cooldownUntil,
      checkedAt: now,
    };
  }
}

export async function runMetaUsageWarmup() {
  await mongooseConnect();
  const now = new Date();
  const users = await User.find({
    metaReconnectNeeded: { $ne: true },
    metaAdAccountId: { $exists: true, $ne: "" },
    metaPageId: { $exists: true, $ne: "" },
    $and: [
      {
        $or: [
          { metaHealthCooldownUntil: { $exists: false } },
          { metaHealthCooldownUntil: null },
          { metaHealthCooldownUntil: { $lt: now } },
        ],
      },
      {
        $or: [
          { metaSystemUserToken: { $exists: true, $ne: "" } },
          { metaAccessToken: { $exists: true, $ne: "" } },
        ],
      },
    ],
  }).limit(50).lean() as any[];

  let checkedUsers = 0;
  let readCalls = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const accessToken = String(user.metaSystemUserToken || user.metaAccessToken || "").trim();
    const adAccountId = normalizeAdAccountId(user.metaAdAccountId);
    if (!accessToken || !adAccountId || user.metaReconnectNeeded) {
      skipped++;
      continue;
    }
    const cooldownUntil = user.metaHealthCooldownUntil ? new Date(user.metaHealthCooldownUntil) : null;
    if (cooldownUntil && cooldownUntil > now) {
      skipped++;
      continue;
    }

    const health = await checkMetaWriteReadiness({
      user,
      accessToken,
      pageId: user.metaPageId,
      adAccountId,
    });
    readCalls += health.ok ? 3 : 1;
    if (!health.ok) {
      failed++;
      continue;
    }

    try {
      await graphGet("me/accounts", accessToken, "id,name,tasks");
      await graphGet("me/adaccounts", accessToken, "id,name,account_id,account_status,currency");
      await graphGet(`act_${adAccountId}`, accessToken, "account_status,disable_reason,currency,timezone_name,amount_spent,balance");
      await graphGet(`act_${adAccountId}/campaigns`, accessToken, "id,name,status,effective_status");
      await graphGet(`act_${adAccountId}/ads`, accessToken, "id,name,status,effective_status");
      await graphGet(`act_${adAccountId}/insights`, accessToken, "spend,impressions,clicks");
      checkedUsers++;
      readCalls += 6;
    } catch (err) {
      failed++;
      await markMetaHealthFailure({ user, error: err });
    }
  }

  return { checkedUsers, readCalls, skipped, failed };
}
