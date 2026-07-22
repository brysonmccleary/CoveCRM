import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import {
  previousUtcDayWindow,
  reconcileBillingForTenant,
  utcDayWindow,
} from "@/lib/billing/reconcileNightly";
import {
  ensureTwilioVoiceBillingIndexes,
  reconcileTwilioVoiceUsageForTenant,
} from "@/lib/billing/reconcileTwilioVoiceUsage";

export const config = { maxDuration: 300 };

function authorized(req: NextApiRequest) {
  const secret = String(process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET || "").trim();
  if (!secret) return false;
  const bearer = String(req.headers.authorization || "");
  const headerSecret = String(req.headers["x-cron-key"] || req.headers["x-cron-secret"] || "");
  // Vercel sends CRON_SECRET as a Bearer token for configured cron jobs.
  // x-vercel-cron is an ordinary client-controlled header and is not proof
  // that a request came from Vercel.
  return bearer === `Bearer ${secret}` || headerSecret === secret;
}

// Forward metering recovery. Twilio is the source of truth; every platform
// subaccount gets a durable discovery cursor and idempotent call candidate.
async function reconcileAllTenants() {
  const users = await User.find({
    "twilio.accountSid": { $type: "string", $ne: "" },
    "numbers.0": { $exists: true },
    billingMode: { $ne: "self" },
    role: { $ne: "admin" },
  })
    .select({ email: 1, "twilio.accountSid": 1 })
    .lean();

  let tenantsChecked = 0;
  let tenantsFailed = 0;
  let callsDiscovered = 0;
  let callsMetered = 0;
  let callsSkipped = 0;
  let callsPending = 0;

  const tenantEmails = (users as any[])
    .map((u) => String(u?.email || "").trim().toLowerCase())
    .filter(Boolean);

  // Keep external billing reads bounded while avoiding a slow fully
  // sequential scan that can exceed a serverless execution window.
  for (let index = 0; index < tenantEmails.length; index += 5) {
    const batch = tenantEmails.slice(index, index + 5);
    await Promise.all(
      batch.map(async (userEmail) => {
        try {
          const report = await reconcileTwilioVoiceUsageForTenant({ userEmail });
          tenantsChecked += 1;
          callsDiscovered += report.discovered;
          callsMetered += report.metered;
          callsSkipped += report.skipped;
          callsPending += report.pending;
          console.log(
            "[billing-meter] tenant healthy",
            JSON.stringify({ userEmail, ...report, accountSid: undefined }),
          );
        } catch (error: any) {
          tenantsFailed += 1;
          console.error(
            "[billing-meter] tenant unhealthy; outbound calling will fail closed",
            JSON.stringify({ userEmail, error: String(error?.message || error).slice(0, 300) }),
          );
        }
      }),
    );
  }

  return {
    tenantsChecked,
    tenantsFailed,
    callsDiscovered,
    callsMetered,
    callsSkipped,
    callsPending,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const userEmail = String(req.query.userEmail || req.body?.userEmail || "").trim().toLowerCase();
  const requestedMode = String(req.query.mode || req.body?.mode || "").trim().toLowerCase();
  const requestedDay = String(req.query.day || req.body?.day || "").trim();
  const window = requestedDay ? utcDayWindow(requestedDay) : previousUtcDayWindow();
  if (!window) return res.status(400).json({ ok: false, error: "day must be YYYY-MM-DD" });

  try {
    await dbConnect();

    // Explicit single-tenant forward mode is used for release verification and
    // incident recovery without forcing a full-fleet run.
    if (userEmail && requestedMode === "forward") {
      await ensureTwilioVoiceBillingIndexes();
      const report = await reconcileTwilioVoiceUsageForTenant({ userEmail });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ok: true, mode: "forward-metering-single-tenant", ...report });
    }

    // Manual historical audit mode — unchanged behavior.
    if (userEmail) {
      const report = await reconcileBillingForTenant({ userEmail, window });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ok: true, mode: "single-tenant", ...report });
    }

    // Cron mode (no userEmail): repair forward usage for every platform
    // subaccount. The first successful run establishes a no-backfill cutoff.
    await ensureTwilioVoiceBillingIndexes();
    const summary = await reconcileAllTenants();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      mode: "forward-metering-all-tenants",
      ...summary,
    });
  } catch (error: any) {
    console.error("[billing-reconciliation] failed", error?.message || error);
    return res.status(500).json({ ok: false, error: "Reconciliation failed" });
  }
}
