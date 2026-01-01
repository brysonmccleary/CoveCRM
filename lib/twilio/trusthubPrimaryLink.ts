// /lib/twilio/trusthubPrimaryLink.ts
/**
 * TrustHub Customer Profile -> EntityAssignments helper
 * This is the hard gate that prevents "Primary customer profile bundle is null"
 *
 * Uses raw fetch + basic auth derived from getClientForUser().auth
 * so we don't accidentally use the wrong Twilio scope.
 *
 * ✅ Fix in this version:
 * - Support optional `X-Twilio-AccountSid` header so the SAME helper works for:
 *   - subaccount auth
 *   - parent auth acting on a subaccount (ISV flow)
 * This removes “it linked but verify can’t see it” edge cases.
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

async function trusthubFetch<T>(
  auth: TrustHubAuth,
  path: string,
  init?: RequestInit,
  opts?: { xTwilioAccountSid?: string | null }
): Promise<T> {
  const url = `https://trusthub.twilio.com/v1${path}`;

  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(auth),
    "Content-Type": "application/x-www-form-urlencoded",
  };

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

  if (!res.ok) {
    // keep body for debugging
    throw new Error(`TrustHub ${res.status} ${res.statusText}: ${text}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    // some responses can be empty; return as any
    return (text as any) as T;
  }
}

type EntityAssignment = {
  sid?: string;
  objectSid?: string; // commonly used
  ObjectSid?: string; // sometimes capitalized
  object_sid?: string; // sometimes snake_case
};

type EntityAssignmentsList = {
  entity_assignments?: EntityAssignment[];
  entityAssignments?: EntityAssignment[];
  results?: EntityAssignment[];
  meta?: any;
};

export async function listEntityAssignmentsForCustomerProfile(params: {
  customerProfileSid: string;
  auth: TrustHubAuth;
  xTwilioAccountSid?: string | null;
}): Promise<string[]> {
  const { customerProfileSid, auth, xTwilioAccountSid } = params;

  // Twilio TrustHub endpoint shape:
  // GET /CustomerProfiles/{CPxxxx}/EntityAssignments
  const data = await trusthubFetch<EntityAssignmentsList>(
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

  // POST /CustomerProfiles/{CP}/EntityAssignments  body: ObjectSid=CPxxxx
  const body = new URLSearchParams();
  body.set("ObjectSid", objectSid);

  await trusthubFetch<any>(
    auth,
    `/CustomerProfiles/${encodeURIComponent(customerProfileSid)}/EntityAssignments`,
    { method: "POST", body },
    { xTwilioAccountSid: xTwilioAccountSid ?? null }
  );
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

  // 1) list
  let assignments = await listEntityAssignmentsForCustomerProfile({
    customerProfileSid: secondaryCustomerProfileSid,
    auth,
    xTwilioAccountSid: xTwilioAccountSid ?? null,
  });

  const alreadyLinked = assignments.includes(primaryCustomerProfileSid);
  if (alreadyLinked) {
    log("already linked ✅", {
      secondaryCustomerProfileSid,
      primaryCustomerProfileSid,
      count: assignments.length,
      xTwilioAccountSid: xTwilioAccountSid ?? null,
    });
    return { ok: true, alreadyLinked: true, linkedNow: false, assignments };
  }

  // 2) attempt create
  log("link missing -> creating assignment…", {
    secondaryCustomerProfileSid,
    primaryCustomerProfileSid,
    xTwilioAccountSid: xTwilioAccountSid ?? null,
  });

  await createEntityAssignmentForCustomerProfile({
    customerProfileSid: secondaryCustomerProfileSid,
    objectSid: primaryCustomerProfileSid,
    auth,
    xTwilioAccountSid: xTwilioAccountSid ?? null,
  });

  // 3) re-check (a couple times to avoid Twilio eventual consistency)
  for (let i = 0; i < 3; i++) {
    assignments = await listEntityAssignmentsForCustomerProfile({
      customerProfileSid: secondaryCustomerProfileSid,
      auth,
      xTwilioAccountSid: xTwilioAccountSid ?? null,
    });

    if (assignments.includes(primaryCustomerProfileSid)) {
      log("linked after create ✅", { attempt: i + 1 });
      return { ok: true, alreadyLinked: false, linkedNow: true, assignments };
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  log("still not linked ❌", {
    assignmentsCount: assignments.length,
    xTwilioAccountSid: xTwilioAccountSid ?? null,
  });

  return { ok: false, alreadyLinked: false, linkedNow: false, assignments };
}
