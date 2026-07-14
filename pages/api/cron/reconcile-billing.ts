import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import {
  previousUtcDayWindow,
  reconcileBillingForTenant,
  utcDayWindow,
  type ReconciliationWindow,
} from "@/lib/billing/reconcileNightly";

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

// Read-only: loops every tenant and calls the existing single-tenant
// reconcileBillingForTenant() as-is. This function performs no writes —
// it only reads and logs. Findings are surfaced via structured console.log
// per tenant so they're inspectable in Vercel's log output; nothing here
// charges, refunds, or otherwise touches money.
async function reconcileAllTenants(window: ReconciliationWindow) {
  const users = await User.find({}).select({ email: 1 }).lean();

  let tenantsChecked = 0;
  let tenantsFailed = 0;
  let tenantsWithFindings = 0;

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
          const report = await reconcileBillingForTenant({ userEmail, window });
          tenantsChecked += 1;

          const hasFindings =
            report.aiFindings.length > 0 ||
            report.manualFindings.length > 0 ||
            report.transferGapCandidates.length > 0 ||
            report.stripeBatchCoverage.some((row: any) => !row.match);

          if (hasFindings) {
            tenantsWithFindings += 1;
            console.log(
              "[billing-reconciliation] DRIFT FOUND",
              JSON.stringify({
                userEmail,
                window: report.window.label,
                summary: report.summary,
                aiFindings: report.aiFindings,
                manualFindings: report.manualFindings,
                transferGapCandidates: report.transferGapCandidates,
                stripeMismatches: report.stripeBatchCoverage.filter((row: any) => !row.match),
              }),
            );
          } else {
            console.log(
              "[billing-reconciliation] clean",
              JSON.stringify({ userEmail, window: report.window.label, summary: report.summary }),
            );
          }
        } catch (error: any) {
          tenantsFailed += 1;
          console.error(
            "[billing-reconciliation] tenant check failed",
            JSON.stringify({ userEmail, error: String(error?.message || error).slice(0, 300) }),
          );
        }
      }),
    );
  }

  return { tenantsChecked, tenantsFailed, tenantsWithFindings };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const userEmail = String(req.query.userEmail || req.body?.userEmail || "").trim().toLowerCase();
  const requestedDay = String(req.query.day || req.body?.day || "").trim();
  const window = requestedDay ? utcDayWindow(requestedDay) : previousUtcDayWindow();
  if (!window) return res.status(400).json({ ok: false, error: "day must be YYYY-MM-DD" });

  try {
    await dbConnect();

    // Manual single-tenant debugging mode — unchanged behavior, still requires userEmail.
    if (userEmail) {
      const report = await reconcileBillingForTenant({ userEmail, window });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ ok: true, mode: "single-tenant", ...report });
    }

    // Cron mode (no userEmail) — loop every tenant, read-only, log findings only.
    const summary = await reconcileAllTenants(window);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      mode: "all-tenants",
      window: { start: window.start.toISOString(), end: window.end.toISOString(), label: window.label },
      ...summary,
    });
  } catch (error: any) {
    console.error("[billing-reconciliation] failed", error?.message || error);
    return res.status(500).json({ ok: false, error: "Reconciliation failed" });
  }
}
