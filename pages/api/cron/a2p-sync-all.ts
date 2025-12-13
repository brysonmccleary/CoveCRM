// /pages/api/cron/a2p-sync-all.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import type { IA2PProfile } from "@/models/A2PProfile";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

const BRAND_OK_FOR_CAMPAIGN = new Set([
  "APPROVED",
  "ACTIVE",
  "IN_USE",
  "REGISTERED",
  "VERIFIED",
]);

function log(...args: any[]) {
  console.log("[CRON a2p-sync-all]", ...args);
}

function normalizeStatus(v: any): string {
  return String(v || "").trim().toUpperCase();
}

async function fetchBrandStatus(client: any, brandSid: string) {
  const brand: any = await client.messaging.v1.brandRegistrations(brandSid).fetch();
  const status = normalizeStatus(brand?.status);
  const rawFailure =
    brand?.failureReason ||
    brand?.failureReasons ||
    brand?.errors ||
    brand?.errorCodes ||
    undefined;

  let failureReason: string | undefined;
  if (!rawFailure) failureReason = undefined;
  else if (typeof rawFailure === "string") failureReason = rawFailure;
  else {
    try {
      failureReason = JSON.stringify(rawFailure);
    } catch {
      failureReason = String(rawFailure);
    }
  }

  return { status, failureReason };
}

async function fetchCampaignStatus(
  client: any,
  messagingServiceSid: string,
  usa2pSid: string,
) {
  const svc: any = client.messaging.v1.services(messagingServiceSid);

  // Direct fetch if available
  if (svc?.usAppToPerson?.(usa2pSid)?.fetch) {
    const c: any = await svc.usAppToPerson(usa2pSid).fetch();
    // Status fields vary by SDK/version; keep it flexible
    const status =
      normalizeStatus(c?.status) ||
      normalizeStatus(c?.campaignStatus) ||
      normalizeStatus(c?.registrationStatus) ||
      "UNKNOWN";
    return { ok: true, status };
  }

  // Fallback list
  if (svc?.usAppToPerson?.list) {
    const list = await svc.usAppToPerson.list({ limit: 50 });
    const found = (list || []).find((x: any) => x?.sid === usa2pSid);
    if (!found) return { ok: false, status: "NOT_FOUND" };
    const status =
      normalizeStatus(found?.status) ||
      normalizeStatus(found?.campaignStatus) ||
      normalizeStatus(found?.registrationStatus) ||
      "UNKNOWN";
    return { ok: true, status };
  }

  return { ok: false, status: "UNKNOWN" };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    // Guard: header or query token
    const headerToken =
      (req.headers["x-cron-secret"] as string) ||
      (req.headers["x-cron-key"] as string) ||
      "";
    const queryToken = String(req.query.secret || req.query.token || "");

    if (!CRON_SECRET) {
      return res.status(500).json({ message: "CRON_SECRET is not set" });
    }
    if (headerToken !== CRON_SECRET && queryToken !== CRON_SECRET) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await mongooseConnect();

    // Only profiles that have brandSid OR are mid-flight
    const profiles = await A2PProfile.find({}).lean<IA2PProfile[]>();

    let updated = 0;
    let notFoundInTenant = 0;
    let errors = 0;

    for (const p of profiles) {
      try {
        const userId = String((p as any).userId || "");
        if (!userId) continue;

        const brandSid = (p as any).brandSid as string | undefined;
        const messagingServiceSid = (p as any).messagingServiceSid as string | undefined;
        const usa2pSid = (p as any).usa2pSid as string | undefined;

        // We need email to resolve tenant Twilio client
        const user = await User.findById(userId).lean<{ email?: string } | null>();
        if (!user?.email) continue;

        const { client, accountSid } = await getClientForUser(user.email);

        // If no brand, nothing to poll (start flow not done yet)
        if (!brandSid) continue;

        // 1) Brand status in tenant account
        let brandStatus = "";
        let brandFailureReason: string | undefined;

        try {
          const b = await fetchBrandStatus(client, brandSid);
          brandStatus = b.status;
          brandFailureReason = b.failureReason;
        } catch (err: any) {
          // If brand not found in tenant account, this is the “wrong account” bug.
          notFoundInTenant++;

          await A2PProfile.updateOne(
            { _id: (p as any)._id },
            {
              $set: {
                brandStatus: "NOT_FOUND",
                messagingReady: false,
                lastError: `BrandSid not found in tenant Twilio account (${accountSid}). Likely created in wrong account previously.`,
                lastSyncedAt: new Date(),
              },
            },
          );

          continue;
        }

        const isBrandEligible = BRAND_OK_FOR_CAMPAIGN.has(brandStatus);
        const isBrandFailed = brandStatus === "FAILED";

        // 2) Campaign status (if we have it)
        let campaignOk: boolean | undefined = undefined;
        let campaignStatus: string | undefined = undefined;

        if (messagingServiceSid && usa2pSid) {
          const c = await fetchCampaignStatus(client, messagingServiceSid, usa2pSid);
          campaignOk = c.ok;
          campaignStatus = c.status;

          // If campaign SID not found, we should clear it so the next submit-campaign can recreate cleanly.
          if (!c.ok && c.status === "NOT_FOUND") {
            await A2PProfile.updateOne(
              { _id: (p as any)._id },
              {
                $unset: { usa2pSid: 1 },
                $set: {
                  messagingReady: false,
                  registrationStatus: isBrandEligible ? "brand_approved" : "pending_review",
                  lastError:
                    "Saved usa2pSid was not found in tenant Twilio account. It will be recreated once eligible.",
                  lastSyncedAt: new Date(),
                },
              },
            );
          }
        }

        // 3) Decide canonical state
        const next: any = {
          brandStatus,
          brandFailureReason,
          lastSyncedAt: new Date(),
        };

        if (isBrandFailed) {
          next.registrationStatus = "rejected";
          next.applicationStatus = "declined";
          next.messagingReady = false;
          next.lastError = brandFailureReason || "Brand registration FAILED.";
        } else if (!isBrandEligible) {
          next.registrationStatus = "pending_review";
          next.applicationStatus = "pending";
          next.messagingReady = false;
          next.lastError = undefined;
        } else {
          // Brand eligible
          next.registrationStatus = usa2pSid ? "ready" : "brand_approved";
          next.applicationStatus = "approved";
          next.messagingReady = Boolean(usa2pSid);

          // If we have campaign status info, keep it for visibility
          if (campaignStatus) next.campaignStatus = campaignStatus;
          if (campaignOk === true && usa2pSid) {
            next.messagingReady = true;
            next.registrationStatus = "ready";
          }
          next.lastError = undefined;
        }

        await A2PProfile.updateOne({ _id: (p as any)._id }, { $set: next });

        updated++;
      } catch (err: any) {
        errors++;
        log("error syncing one profile", {
          message: err?.message,
          stack: err?.stack,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      total: profiles.length,
      updated,
      notFoundInTenant,
      errors,
    });
  } catch (err: any) {
    console.error("[CRON a2p-sync-all] fatal error:", err);
    return res.status(500).json({
      message: "a2p-sync-all failed",
      error: err?.message || String(err),
    });
  }
}
