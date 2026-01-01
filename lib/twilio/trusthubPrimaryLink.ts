// /lib/twilio/trusthubPrimaryLink.ts
/**
 * TrustHub Customer Profile -> EntityAssignments helper
 * Hard gate to prevent: "Primary customer profile bundle is null"
 *
 * ISV-critical behavior:
 * - When doing parent acting on subaccount, MUST use:
 *   - parent auth
 *   - X-Twilio-AccountSid: <subaccount AC...>
 * - And MUST block brand creation until TrustHub returns primary BU in assignments.
 */

import { Buffer } from "buffer";

export type TrustHubAuth = {
  username: string; // AC... or SK...
  password: string; // auth token or api secret
};

function basicAuthHeader(auth: TrustHubAuth) {
  const token = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
  return `Basic ${token}`;
}

async function trusthubFetchRaw(
  auth: TrustHubAuth,
  path: string,
  init?: RequestInit,
  opts?: { xTwilioAccountSid?: string | null }
): Promise<{ status: number; ok: boolean; text: string }> {
  const url = `https://trusthub.twilio.com/v1${path}`;

  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(auth),
  };

  // Only set content-type if we actually have a body (POST)
  const hasBody = !!(init as any)?.body;
  if (hasBody) headers["Content-Type"] = "application/x-www-form-urlencoded";

  const xSid = opts?.xTwilioAccountSid;
  if (xSid) headers["X-Twilio-AccountSid"] = xSid;

  const res = await fetch(url, {
    ...(init || {}),
    headers: {
      ...headers,
      ...(init?.headers || {}),
    } as any,
  });

  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

async function trusthubFetchJson<T>(
  auth: TrustHubAuth,
  path: string,
  init?: RequestInit,
  opts?: { xTwilioAccountSid?: string | null }
): Promise<T> {
  const r = await trusthubFetchRaw(auth, path, init, opts);

  if (!r.ok) {
    throw new Error(`TrustHub ${r.status}: ${r.text}`);
  }

  // Some responses can be empty
  if (!r.text) return ({} as any) as T;

  try {
    return JSON.parse(r.text) as T;
  } catch {
    return (r.text as any) as T;
  }
}

type EntityAssignmentsList = {
  entity_assignments?: any[];
  entityAssignments?: any[];
  results?: any[];
  meta?: any;
};

export async function listEntityAssignmentsForCustomerProfile(params: {
  customerProfileSid: string;
  auth: TrustHubAuth;
  xTwilioAccountSid?: string | null;
}): Promise<string[]> {
  const { customerProfileSid, auth, xTwilioAccountSid } = params;

  const data = await trusthubFetchJson<EntityAssignmentsList>(
    auth,
    `/CustomerProfiles/${encodeURIComponent(customerProfileSid)}/EntityAssignments`,
    { method: "GET" },
    { xTwilioAccountSid: xTwilioAccountSid ?? null }
  );

  const arr =
    (data as any)?.entity_assignments ||
    (data as any)?.entityAssignments ||
    (data as any)?.results ||
    [];

  const sids = (arr || [])
    .map((a: any) => a?.objectSid || a?.ObjectSid || a?.object_sid || "")
    .filter(Boolean);

  return Array.from(new Set(sids));
}

export async function createEntityAssignmentForCustomerProfile(params: {
  customerProfileSid: string;
  objectSid: string;
  auth: TrustHubAuth;
  xTwilioAccountSid?: string | null;
}): Promise<void> {
  const { customerProfileSid, objectSid, auth, xTwilioAccountSid } = params;

  const body = new URLSearchParams();
  body.set("ObjectSid", objectSid);

  // Twilio can return 409 if the assignment already exists; treat that as OK.
  const r = await trusthubFetchRaw(
    auth,
    `/CustomerProfiles/${encodeURIComponent(customerProfileSid)}/EntityAssignments`,
    { method: "POST", body },
    { xTwilioAccountSid: xTwilioAccountSid ?? null }
  );

  if (r.ok) return;

  // Common safe-to-ignore cases
  if (r.status === 409) return;

  // Some deployments return 400 with "already exists" text
  const lower = (r.text || "").toLowerCase();
  if (r.status === 400 && lower.includes("already") && lower.includes("exist")) return;

  throw new Error(`TrustHub ${r.status}: ${r.text}`);
}

export async function ensurePrimaryLinkedToSecondary(params: {
  secondaryCustomerProfileSid: string;
  primaryCustomerProfileSid: string;
  auth: TrustHubAuth;
  requestId?: string;
  xTwilioAccountSid?: string | null;
}): Promise<{
  ok: boolean;
  alreadyLinked: boolean;
  linkedNow: boolean;
  assignments: string[];
  attempts: number;
}> {
  const {
    secondaryCustomerProfileSid,
    primaryCustomerProfileSid,
    auth,
    requestId,
    xTwilioAccountSid,
  } = params;

  const log = (...args: any[]) => {
    console.log("[A2P PrimaryLink]", requestId || "-", ...args);
  };

  const scope = {
    authUsernamePrefix: (auth.username || "").slice(0, 2),
    xTwilioAccountSid: xTwilioAccountSid ?? null,
    secondaryCustomerProfileSid,
    primaryCustomerProfileSid,
  };

  // 1) initial list
  let assignments = await listEntityAssignmentsForCustomerProfile({
    customerProfileSid: secondaryCustomerProfileSid,
    auth,
    xTwilioAccountSid: xTwilioAccountSid ?? null,
  });

  if (assignments.includes(primaryCustomerProfileSid)) {
    log("already linked ✅", { ...scope, count: assignments.length });
    return {
      ok: true,
      alreadyLinked: true,
      linkedNow: false,
      assignments,
      attempts: 0,
    };
  }

  // 2) create
  log("link missing -> creating assignment…", scope);

  await createEntityAssignmentForCustomerProfile({
    customerProfileSid: secondaryCustomerProfileSid,
    objectSid: primaryCustomerProfileSid,
    auth,
    xTwilioAccountSid: xTwilioAccountSid ?? null,
  });

  // 3) poll until TrustHub shows it (ISV consistency can take time)
  const maxAttempts = 12; // ~45s with backoff
  for (let i = 0; i < maxAttempts; i++) {
    assignments = await listEntityAssignmentsForCustomerProfile({
      customerProfileSid: secondaryCustomerProfileSid,
      auth,
      xTwilioAccountSid: xTwilioAccountSid ?? null,
    });

    if (assignments.includes(primaryCustomerProfileSid)) {
      log("linked after create ✅", { ...scope, attempt: i + 1, count: assignments.length });
      return {
        ok: true,
        alreadyLinked: false,
        linkedNow: true,
        assignments,
        attempts: i + 1,
      };
    }

    // exponential-ish backoff: 0.5s, 0.8s, 1.2s, 1.8s, 2.6s... capped ~5s
    const waitMs = Math.min(5000, Math.floor(500 * Math.pow(1.45, i)));
    await new Promise((r) => setTimeout(r, waitMs));
  }

  log("still not linked ❌", { ...scope, assignmentsCount: assignments.length });
  return {
    ok: false,
    alreadyLinked: false,
    linkedNow: false,
    assignments,
    attempts: maxAttempts,
  };
}
