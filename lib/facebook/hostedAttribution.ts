import crypto from "crypto";

export type HostedAttributionTokenPayload = {
  version: 1;
  campaignId: string;
  variantId: string;
  creativeFamily: string;
  issuedAt: number;
};

export type HostedAttributionRecord = {
  variantId?: string;
  metaAdId?: string;
  metaCreativeId?: string;
  creativeFamily?: string;
};

function attributionSecret() {
  const secret = String(
    process.env.META_ATTRIBUTION_SECRET ||
      process.env.WEBHOOK_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      ""
  ).trim();
  if (!secret) throw new Error("Hosted-funnel attribution signing secret is not configured");
  return secret;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(encodedPayload: string) {
  return crypto.createHmac("sha256", attributionSecret()).update(encodedPayload).digest("base64url");
}

export function signHostedAttributionToken(input: {
  campaignId: unknown;
  variantId: unknown;
  creativeFamily?: unknown;
  issuedAt?: number;
}) {
  const payload: HostedAttributionTokenPayload = {
    version: 1,
    campaignId: String(input.campaignId || "").trim(),
    variantId: String(input.variantId || "").trim(),
    creativeFamily: String(input.creativeFamily || "").trim(),
    issuedAt: Number.isInteger(input.issuedAt) ? Number(input.issuedAt) : Date.now(),
  };
  if (!payload.campaignId || !payload.variantId) {
    throw new Error("Hosted-funnel attribution requires campaignId and variantId");
  }
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifyHostedAttributionToken(token: unknown): HostedAttributionTokenPayload {
  const raw = String(token || "").trim();
  const [encodedPayload, suppliedSignature, extra] = raw.split(".");
  if (!encodedPayload || !suppliedSignature || extra) throw new Error("Invalid attribution token");
  const expectedSignature = signature(encodedPayload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid attribution token signature");
  }
  let payload: HostedAttributionTokenPayload;
  try {
    payload = JSON.parse(decode(encodedPayload));
  } catch {
    throw new Error("Invalid attribution token payload");
  }
  if (
    payload?.version !== 1 ||
    !String(payload.campaignId || "").trim() ||
    !String(payload.variantId || "").trim() ||
    !Number.isFinite(payload.issuedAt)
  ) {
    throw new Error("Invalid attribution token payload");
  }
  return payload;
}

export function resolveHostedAttribution(input: {
  token: unknown;
  campaignId: unknown;
  ads: HostedAttributionRecord[];
}) {
  const payload = verifyHostedAttributionToken(input.token);
  if (payload.campaignId !== String(input.campaignId || "").trim()) {
    throw new Error("Attribution token campaign mismatch");
  }
  const ad = (Array.isArray(input.ads) ? input.ads : []).find(
    (candidate) => String(candidate?.variantId || "").trim() === payload.variantId
  );
  if (!ad) throw new Error("Attributed ad variant was not found on this campaign");
  const storedFamily = String(ad.creativeFamily || "").trim();
  if (storedFamily !== payload.creativeFamily) {
    throw new Error("Attribution token creative family mismatch");
  }
  return {
    metaAdId: String(ad.metaAdId || "").trim(),
    metaCreativeId: String(ad.metaCreativeId || "").trim(),
    variantId: payload.variantId,
    creativeFamily: storedFamily,
  };
}

export function stableLeadEventId(namespace: string, sourceId: unknown) {
  const value = `${String(namespace || "lead").trim()}:${String(sourceId || "").trim()}`;
  if (value.endsWith(":")) throw new Error("Stable lead event ID requires a source ID");
  return crypto.createHash("sha256").update(value).digest("hex");
}
