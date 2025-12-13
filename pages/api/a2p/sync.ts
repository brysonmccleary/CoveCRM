// /pages/api/a2p/sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { sendA2PApprovedEmail, sendA2PDeclinedEmail } from "@/lib/a2p/notifications";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";

const APPROVED = new Set([
  "approved",
  "verified",
  "active",
  "in_use",
  "registered",
  "campaign_approved",
]);

const DECLINED_MATCH = /(reject|denied|declined|failed|error)/i;

type AnyDoc = Record<string, any>;

function classifyFromDoc(p: AnyDoc) {
  const docState = String(p?.state || "").toLowerCase();
  const appStatus = String(p?.applicationStatus || "").toLowerCase();
  if (docState === "approved" || appStatus === "approved") return { state: "approved" as const };
  if (docState === "declined" || appStatus === "declined") return { state: "declined" as const };
  return { state: "pending" as const };
}

function listMissingSids(p: AnyDoc) {
  const required = [
    ["profileSid", p?.profileSid],
    ["brandSid", p?.brandSid],
    ["trustProductSid", p?.trustProductSid],
    ["campaignSid/usa2pSid", p?.campaignSid || p?.usa2pSid],
    ["messagingServiceSid", p?.messagingServiceSid],
  ] as const;
  return required.filter(([, v]) => !v).map(([k]) => k);
}

function hasA2PSubmissionData(p: AnyDoc): boolean {
  return Boolean(
    p?.profileSid ||
      p?.trustProductSid ||
      p?.brandSid ||
      p?.campaignSid ||
      p?.usa2pSid ||
      p?.lastSubmittedUseCase ||
      p?.lastSubmittedOptInDetails ||
      (Array.isArray(p?.lastSubmittedSampleMessages) && p?.lastSubmittedSampleMessages.length > 0)
  );
}

function deriveUseCase(doc: AnyDoc): string {
  return doc.lastSubmittedUseCase || doc.useCase || doc.usecaseCode || "LOW_VOLUME";
}

function deriveMessageSamples(doc: AnyDoc): string[] {
  if (Array.isArray(doc.lastSubmittedSampleMessages) && doc.lastSubmittedSampleMessages.length) {
    return doc.lastSubmittedSampleMessages
      .map((s: any) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  if (Array.isArray(doc.sampleMessagesArr) && doc.sampleMessagesArr.length) {
    return doc.sampleMessagesArr
      .map((s: any) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  if (Array.isArray(doc.sampleMessages) && doc.sampleMessages.length) {
    return doc.sampleMessages
      .map((s: any) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  if (typeof doc.sampleMessages === "string" && doc.sampleMessages.trim()) {
    return doc.sampleMessages
      .split(/\n{2,}|\r{2,}/)
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  const candidates = [doc.sampleMessage1, doc.sampleMessage2, doc.sampleMessage3]
    .map((s: any) => (s ? String(s).trim() : ""))
    .filter(Boolean);

  return candidates.slice(0, 3);
}

function deriveMessageFlow(doc: AnyDoc): string {
  return (doc.lastSubmittedOptInDetails || doc.optInDetails || doc.messageFlow || "").trim();
}

function hasEmbeddedLinks(flow: string, samples: string[]): boolean {
  const text = [flow, ...samples].join(" ");
  return /https?:\/\//i.test(text);
}

function hasEmbeddedPhone(flow: string, samples: string[]): boolean {
  const text = [flow, ...samples].join(" ");
  return /\+\d{7,}/.test(text) || /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(text);
}

async function recoverBrandSidByBundlePairTenant(args: {
  client: any;
  profileSid: string | null;
  trustProductSid: string | null;
}): Promise<string | null> {
  const { client, profileSid, trustProductSid } = args;
  if (!client) return null;
  if (!profileSid || !trustProductSid) return null;

  try {
    const list = (await (client.messaging.v1 as any).brandRegistrations.list({ limit: 50 })) || [];
    const match = list.find((b: any) => {
      const cp = b?.customerProfileBundleSid || b?.customerProfileSid;
      const tp =
        b?.a2PProfileBundleSid ||
        b?.a2pProfileBundleSid ||
        b?.a2PProfileSid ||
        b?.a2pProfileSid;
      return cp === profileSid && tp === trustProductSid;
    });

    const sid = match?.sid || match?.brandSid || match?.id;
    return typeof sid === "string" && sid.startsWith("BN") ? sid : null;
  } catch {
    return null;
  }
}

async function ensureCampaignForApprovedBrandTenant(args: {
  client: any;
  doc: AnyDoc;
  brandStatus?: string;
  brandSid: string | null;
  messagingServiceSid: string | null;
}): Promise<{ created: boolean; campaignSid: string | null; campaignStatus?: string }> {
  const { client, doc, brandStatus, brandSid, messagingServiceSid } = args;

  if (!client) return { created: false, campaignSid: doc.campaignSid || doc.usa2pSid || null };
  if (!brandSid || !messagingServiceSid) {
    return { created: false, campaignSid: doc.campaignSid || doc.usa2pSid || null };
  }

  const existingCampaignSid = doc.campaignSid || doc.usa2pSid;
  if (existingCampaignSid) return { created: false, campaignSid: existingCampaignSid };

  const lowerBrand = (brandStatus || "").toLowerCase();
  if (!lowerBrand || !APPROVED.has(lowerBrand)) return { created: false, campaignSid: null };

  const useCase = deriveUseCase(doc);
  const messageSamples = deriveMessageSamples(doc);
  const flow = deriveMessageFlow(doc);

  if (!messageSamples.length || !flow) {
    await A2PProfile.updateOne(
      { _id: doc._id },
      {
        $set: {
          lastError: "Brand approved but missing messageSamples/optInDetails for auto campaign creation.",
          lastSyncedAt: new Date(),
        },
      }
    );
    return { created: false, campaignSid: null };
  }

  const description = flow.slice(0, 180) || `Messaging campaign for ${doc.businessName || "CoveCRM user"}`;
  const embeddedLinks = hasEmbeddedLinks(flow, messageSamples);
  const embeddedPhone = hasEmbeddedPhone(flow, messageSamples);

  try {
    const usA2p = await client.messaging.v1.services(messagingServiceSid).usAppToPerson.create({
      brandRegistrationSid: brandSid,
      description,
      hasEmbeddedLinks: embeddedLinks,
      hasEmbeddedPhone: embeddedPhone,
      messageSamples,
      usAppToPersonUsecase: useCase,
    });

    const campaignSid =
      usA2p?.sid || usA2p?.campaignSid || usA2p?.campaign_id || usA2p?.campaignId || null;

    const status = usA2p?.status || "pending";

    if (campaignSid) {
      await A2PProfile.updateOne(
        { _id: doc._id },
        {
          $set: {
            campaignSid,
            usa2pSid: campaignSid,
            registrationStatus: status,
            lastError: undefined,
            lastSyncedAt: new Date(),
          },
        }
      );
    } else {
      await A2PProfile.updateOne(
        { _id: doc._id },
        {
          $set: {
            lastError: "auto-campaign created but did not return a campaign SID (QE...).",
            lastSyncedAt: new Date(),
          },
        }
      );
    }

    return { created: true, campaignSid, campaignStatus: status };
  } catch (e: any) {
    await A2PProfile.updateOne(
      { _id: doc._id },
      { $set: { lastError: `auto-campaign: ${e?.message || String(e)}`, lastSyncedAt: new Date() } }
    );
    return { created: false, campaignSid: null };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  if (CRON_SECRET && req.headers["x-cron-key"] !== CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await mongooseConnect();

  const includeApproved = String(req.query.includeApproved ?? "") === "1";
  const userIdFilter =
    typeof req.query.userId === "string" && req.query.userId.trim() ? String(req.query.userId).trim() : null;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 200) || 200));

  const baseQuery = includeApproved
    ? {}
    : {
        $or: [
          { applicationStatus: { $in: [null, "pending"] } },
          { state: { $in: [null, "pending"] } },
          { messagingReady: { $ne: true } },
        ],
      };

  const finalQuery = userIdFilter ? { ...baseQuery, userId: userIdFilter } : baseQuery;

  const candidates: AnyDoc[] = await A2PProfile.find(finalQuery).limit(limit).lean();
  const results: AnyDoc[] = [];

  for (const doc of candidates) {
    const id = String(doc._id);
    const userId = doc.userId ? String(doc.userId) : null;

    const profileSid = doc.profileSid || null;
    let brandSid = doc.brandSid || null;
    const trustProductSid = doc.trustProductSid || null;
    let campaignSid = doc.campaignSid || doc.usa2pSid || null;
    let messagingServiceSid = doc.messagingServiceSid || null;

    const baseClass = classifyFromDoc(doc);

    if (!hasA2PSubmissionData(doc)) {
      results.push({
        id,
        userId,
        state: "not_submitted",
        profileSid,
        brandSid,
        trustProductSid,
        campaignSid,
        messagingServiceSid,
        missing: listMissingSids(doc),
        lastSyncedAt: new Date().toISOString(),
      });
      continue;
    }

    const user = userId ? await User.findById(userId).lean<any>() : null;
    const userEmail = user?.email ? String(user.email).toLowerCase().trim() : null;

    if (!userEmail) {
      results.push({
        id,
        userId,
        state: "error",
        error: userId ? "User not found or missing email for A2PProfile.userId" : "Missing A2PProfile.userId",
        profileSid,
        brandSid,
        trustProductSid,
        campaignSid,
        messagingServiceSid,
        missing: listMissingSids(doc),
      });
      continue;
    }

    let client: any = null;
    let accountSidUsed: string | null = null;

    try {
      const resolved = await getClientForUser(userEmail);
      client = resolved.client as any;
      accountSidUsed = resolved.accountSid;
    } catch (e: any) {
      // ✅ Do not kill the batch. Record error and continue.
      results.push({
        id,
        userId,
        userEmail,
        state: "error",
        error: `getClientForUser: ${e?.message || String(e)}`,
        profileSid,
        brandSid,
        trustProductSid,
        campaignSid,
        messagingServiceSid,
        missing: listMissingSids(doc),
      });
      continue;
    }

    // Fast-path: already approved by webhook/state
    if (baseClass.state === "approved") {
      try {
        await A2PProfile.updateOne(
          { _id: doc._id },
          {
            $set: {
              messagingReady: true,
              applicationStatus: "approved",
              registrationStatus: doc.registrationStatus || "campaign_approved",
              lastSyncedAt: new Date(),
            },
            $unset: { lastError: 1 },
          }
        );

        if (!doc.approvalNotifiedAt) {
          try {
            await sendA2PApprovedEmail({
              to: userEmail,
              name: user?.name || undefined,
              dashboardUrl: `${BASE_URL}/settings/messaging`,
            });
            await A2PProfile.updateOne({ _id: doc._id }, { $set: { approvalNotifiedAt: new Date() } });
          } catch (e: any) {
            await A2PProfile.updateOne({ _id: doc._id }, { $set: { lastError: `notify: ${e?.message || e}` } });
          }
        }

        results.push({
          id,
          userId,
          userEmail,
          accountSidUsed,
          profileSid,
          brandSid,
          trustProductSid,
          campaignSid,
          messagingServiceSid,
          state: "approved",
          missing: listMissingSids(doc),
          lastSyncedAt: new Date().toISOString(),
        });
      } catch (e: any) {
        results.push({
          id,
          userId,
          userEmail,
          accountSidUsed,
          state: "error",
          error: e?.message || String(e),
          profileSid,
          brandSid,
          trustProductSid,
          campaignSid,
          messagingServiceSid,
          missing: listMissingSids(doc),
        });
      }
      continue;
    }

    let recoveredBrandSid: string | null = null;
    if (!brandSid && profileSid && trustProductSid) {
      recoveredBrandSid = await recoverBrandSidByBundlePairTenant({
        client,
        profileSid,
        trustProductSid,
      });

      if (recoveredBrandSid) {
        brandSid = recoveredBrandSid;
        await A2PProfile.updateOne(
          { _id: doc._id },
          { $set: { brandSid: recoveredBrandSid, lastSyncedAt: new Date() }, $unset: { lastError: 1 } }
        );
      }
    }

    let brandStatus: string | undefined;
    let campStatus: string | undefined;

    try {
      if (brandSid) {
        const brand = await client.messaging.v1.brandRegistrations(brandSid).fetch();
        brandStatus = (brand as any)?.status || (brand as any)?.state;
      }
    } catch {
      // ignore
    }

    try {
      if (
        brandSid &&
        messagingServiceSid &&
        !campaignSid &&
        brandStatus &&
        APPROVED.has(String(brandStatus).toLowerCase())
      ) {
        const auto = await ensureCampaignForApprovedBrandTenant({
          client,
          doc: { ...doc, brandSid },
          brandStatus,
          brandSid,
          messagingServiceSid,
        });

        if (auto.campaignSid) {
          campaignSid = auto.campaignSid;
          campStatus = auto.campaignStatus || campStatus;
        }
      }
    } catch {
      // already logged into lastError
    }

    try {
      if (campaignSid && messagingServiceSid) {
        const usA2p = await client.messaging.v1.services(messagingServiceSid).usAppToPerson(campaignSid).fetch();
        campStatus = (usA2p as any)?.status || (usA2p as any)?.state;
      }
    } catch {
      // ignore
    }

    const statusStrings = [brandStatus, campStatus].filter(Boolean).map((s) => String(s).toLowerCase());

    const isApproved = statusStrings.some((s) => APPROVED.has(s));
    const isDeclined = statusStrings.some((s) => DECLINED_MATCH.test(s));

    const missing = listMissingSids({ ...doc, brandSid, campaignSid });

    try {
      if (isApproved) {
        await A2PProfile.updateOne(
          { _id: doc._id },
          {
            $set: {
              messagingReady: true,
              applicationStatus: "approved",
              registrationStatus: statusStrings.some(
                (s) => s === "campaign_approved" || s === "in_use" || s === "registered"
              )
                ? "campaign_approved"
                : "ready",
              lastSyncedAt: new Date(),
            },
            $unset: { lastError: 1 },
          }
        );

        if (!doc.approvalNotifiedAt) {
          try {
            await sendA2PApprovedEmail({
              to: userEmail,
              name: user?.name || undefined,
              dashboardUrl: `${BASE_URL}/settings/messaging`,
            });
            await A2PProfile.updateOne({ _id: doc._id }, { $set: { approvalNotifiedAt: new Date() } });
          } catch (e: any) {
            await A2PProfile.updateOne({ _id: doc._id }, { $set: { lastError: `notify: ${e?.message || e}` } });
          }
        }

        results.push({
          id,
          userId,
          userEmail,
          accountSidUsed,
          profileSid,
          brandSid,
          trustProductSid,
          campaignSid,
          messagingServiceSid,
          state: "approved",
          brandStatus: brandStatus || null,
          campaignStatus: campStatus || null,
          missing,
          recoveredBrandSid,
          lastSyncedAt: new Date().toISOString(),
        });
        continue;
      }

      if (isDeclined) {
        await A2PProfile.updateOne(
          { _id: doc._id },
          {
            $set: {
              messagingReady: false,
              applicationStatus: "declined",
              registrationStatus: "rejected",
              lastSyncedAt: new Date(),
            },
          }
        );

        try {
          await sendA2PDeclinedEmail({
            to: userEmail,
            name: user?.name || undefined,
            reason: doc.declinedReason || "Declined by reviewers",
            helpUrl: `${BASE_URL}/help/a2p-checklist`,
          });
        } catch (e: any) {
          await A2PProfile.updateOne({ _id: doc._id }, { $set: { lastError: `notify: ${e?.message || e}` } });
        }

        results.push({
          id,
          userId,
          userEmail,
          accountSidUsed,
          profileSid,
          brandSid,
          trustProductSid,
          campaignSid,
          messagingServiceSid,
          state: "declined",
          brandStatus: brandStatus || null,
          campaignStatus: campStatus || null,
          missing,
          recoveredBrandSid,
          lastSyncedAt: new Date().toISOString(),
        });
        continue;
      }

      await A2PProfile.updateOne({ _id: doc._id }, { $set: { lastSyncedAt: new Date() } });

      results.push({
        id,
        userId,
        userEmail,
        accountSidUsed,
        profileSid,
        brandSid,
        trustProductSid,
        campaignSid,
        messagingServiceSid,
        state: "pending",
        brandStatus: brandStatus || null,
        campaignStatus: campStatus || null,
        missing,
        recoveredBrandSid,
        lastSyncedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      results.push({
        id,
        userId,
        userEmail,
        accountSidUsed,
        profileSid,
        brandSid,
        trustProductSid,
        campaignSid,
        messagingServiceSid,
        state: "error",
        error: e?.message || String(e),
        missing,
        recoveredBrandSid,
      });
    }
  }

  return res.status(200).json({ ok: true, checked: results.length, results });
}
