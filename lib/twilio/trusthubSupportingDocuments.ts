// /lib/twilio/trusthubSupportingDocuments.ts
import type Twilio from "twilio";

/**
 * SupportingDocuments live on TrustHub:
 *   https://trusthub.twilio.com/v1/SupportingDocuments
 *
 * The bug you’re seeing (20404 /v1/SupportingDocuments not found) commonly happens
 * when the Twilio SDK internal request router does NOT honor the TrustHub host
 * for raw request() fallbacks and instead hits api.twilio.com or another default base.
 *
 * This helper fixes that by:
 *  1) Prefer official SDK resource if present:
 *       client.trusthub.v1.supportingDocuments.create(...)
 *  2) If not present, use DIRECT fetch() to trusthub.twilio.com (not client.request)
 *     and force correct subaccount scoping via X-Twilio-AccountSid when needed.
 */

export type TwilioAuthMode = "authToken" | "apiKey";

export type TwilioResolvedAuth = {
  mode: TwilioAuthMode;
  username: string; // Basic auth username: either AccountSid or ApiKeySid
  password: string; // Basic auth password: either AuthToken or ApiKeySecret
  /**
   * The Twilio Account SID that should own the created TrustHub resources.
   * For your multi-tenant setup, this MUST be the user's subaccount SID.
   */
  effectiveAccountSid: string;
};

export type SupportingDocumentCreateArgs = {
  friendlyName: string;
  /**
   * Twilio calls this the "Type" field. Common examples:
   * - "customer_profile_address"
   * - "customer_profile_business_information"
   * etc.
   */
  type: string;

  /**
   * Twilio expects "Attributes" as JSON string in form encoding.
   * Example for an address document:
   *   { address_sids: ["ADxxxxxxxx"] }
   */
  attributes: Record<string, any>;
};

function toFormUrlEncoded(body: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) params.append(k, v);
  return params.toString();
}

function basicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${token}`;
}

async function fetchTrustHub<T>(
  auth: TwilioResolvedAuth,
  method: "POST" | "GET",
  path: string,
  form?: Record<string, string>
): Promise<T> {
  const url = `https://trusthub.twilio.com${path}`;
  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(auth.username, auth.password),
  };

  // IMPORTANT:
  // When authenticating with parent creds or an API key that is not inherently
  // "bound" to the subaccount, you MUST force the intended account scope.
  // Twilio supports X-Twilio-AccountSid for acting on behalf of a subaccount.
  headers["X-Twilio-AccountSid"] = auth.effectiveAccountSid;

  let body: string | undefined;
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = toFormUrlEncoded(form || {});
  }

  const res = await fetch(url, { method, headers, body });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }

  if (!res.ok) {
    const code = json?.code ?? res.status;
    const message = json?.message ?? text ?? `HTTP ${res.status}`;
    const moreInfo = json?.more_info;
    const details = json?.details;

    const err = new Error(
      `[TrustHub] ${method} ${path} failed (${res.status}) code=${code} message=${message}${
        moreInfo ? ` more_info=${moreInfo}` : ""
      }${details ? ` details=${JSON.stringify(details)}` : ""}`
    );
    (err as any).status = res.status;
    (err as any).twilio = json;
    throw err;
  }

  return json as T;
}

export async function createSupportingDocument(
  client: Twilio.Twilio,
  auth: TwilioResolvedAuth,
  args: SupportingDocumentCreateArgs
): Promise<{ sid: string; raw: any }> {
  // 1) Prefer official SDK resource if it exists
  const maybeSdk = (client as any)?.trusthub?.v1?.supportingDocuments;
  if (maybeSdk && typeof maybeSdk.create === "function") {
    const created = await maybeSdk.create({
      friendlyName: args.friendlyName,
      type: args.type,
      attributes: args.attributes, // Twilio SDK handles serialization
    });

    if (!created?.sid) {
      throw new Error(
        `[TrustHub] SDK supportingDocuments.create returned no sid`
      );
    }
    return { sid: created.sid, raw: created };
  }

  // 2) Reliable fallback: direct fetch to TrustHub host
  const created = await fetchTrustHub<any>(auth, "POST", "/v1/SupportingDocuments", {
    FriendlyName: args.friendlyName,
    Type: args.type,
    Attributes: JSON.stringify(args.attributes),
  });

  if (!created?.sid) {
    throw new Error(
      `[TrustHub] fetch SupportingDocuments returned no sid: ${JSON.stringify(
        created
      )}`
    );
  }

  // Optional verification (cheap, and catches “wrong account scope” instantly)
  const verified = await fetchTrustHub<any>(
    auth,
    "GET",
    `/v1/SupportingDocuments/${created.sid}`
  );

  if (!verified?.sid || verified.sid !== created.sid) {
    throw new Error(
      `[TrustHub] SupportingDocument verification failed for sid=${created.sid}`
    );
  }

  return { sid: created.sid, raw: created };
}
