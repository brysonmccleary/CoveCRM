// /pages/api/a2p/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const APPROVED = new Set([
  "approved",
  "verified",
  "active",
  "in_use",
  "registered",
  "campaign_approved",
]);

const PENDING = new Set([
  "pending",
  "submitted",
  "under_review",
  "pending-review",
  "in_progress",
  "campaign_submitted",
]);

const FAILED = new Set([
  "failed",
  "rejected",
  "declined",
  "brand_failed",
  "campaign_failed",
  "terminated",
]);

type NextAction =
  | "start_profile"
  | "submit_brand"
  | "brand_pending"
  | "submit_campaign"
  | "campaign_pending"
  | "create_messaging_service"
  | "ready";

function safeLower(v: any) {
  return String(v || "").toLowerCase();
}

function flattenErrorsText(errorsArr: any[]): string {
  if (!Array.isArray(errorsArr) || !errorsArr.length) return "";
  return errorsArr
    .map((e: any) => {
      const code = e?.code ? `(${e.code}) ` : "";
      const msg =
        e?.message ||
        e?.detail ||
        e?.description ||
        (typeof e === "string" ? e : "");
      const fallback =
        msg ||
        (() => {
          try {
            return JSON.stringify(e);
          } catch {
            return String(e);
          }
        })();
      return `${code}${fallback}`.trim();
    })
    .filter(Boolean)
    .join(" | ");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    await mongooseConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const a2p = await A2PProfile.findOne({ userId: String(user._id) });
    if (!a2p) {
      return res.status(200).json({
        nextAction: "start_profile" as NextAction,
        registrationStatus: "not_started",
        messagingReady: false,
        canSendSms: false,
        applicationStatus: "pending",
        a2pStatusLabel: "Pending",
        declinedReason: null,
        brand: { sid: null, status: "unknown" },
        campaign: { sid: null, status: "unknown" },
        messagingServiceSid: null,
        senders: [],
        hints: {
          hasProfile: false,
          hasBrand: false,
          hasCampaign: false,
          hasMessagingService: false,
        },
      });
    }

    // ✅ Resolve tenant Twilio context (subaccount/personal/platform)
    let client: any = null;
    let twilioAccountSidUsed: string | null = null;

    try {
      const resolved = await getClientForUser(session.user.email);
      client = resolved.client;
      twilioAccountSidUsed = resolved.accountSid;
      console.log("[A2P status] twilioAccountSidUsed", { twilioAccountSidUsed });

      // ✅ Optional proof: list brands in this scoped context
      if ((process.env.A2P_DEBUG_BRANDS || "") === "1") {
        try {
          const brands = await (client.messaging.v1 as any).brandRegistrations.list({ limit: 20 });
          console.log("[A2P status] debug: brandRegistrations.list count", brands?.length || 0);
          console.log(
            "[A2P status] debug: brandRegistrations.list sids",
            (brands || []).map((b: any) => ({ sid: b?.sid, status: b?.status })),
          );
        } catch (e: any) {
          console.warn("[A2P status] debug: brandRegistrations.list failed", {
            message: e?.message || String(e),
          });
        }
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.warn("[A2P status] getClientForUser failed (non-fatal)", { msg });

      return res.status(200).json({
        nextAction: "start_profile" as NextAction,
        registrationStatus: a2p.registrationStatus || "unknown",
        messagingReady: Boolean(a2p.messagingReady),
        canSendSms: false,
        applicationStatus: (a2p as any).applicationStatus || "pending",
        a2pStatusLabel: "Pending",
        declinedReason: a2p.declinedReason || null,
        brand: { sid: a2p.brandSid || null, status: (a2p as any).brandStatus || "unknown" },
        campaign: { sid: (a2p as any).usa2pSid || (a2p as any).campaignSid || null, status: "unknown" },
        messagingServiceSid: a2p.messagingServiceSid || null,
        senders: [],
        hints: {
          hasProfile: Boolean((a2p as any).profileSid),
          hasBrand: Boolean(a2p.brandSid),
          hasCampaign: Boolean((a2p as any).usa2pSid || (a2p as any).campaignSid),
          hasMessagingService: Boolean(a2p.messagingServiceSid),
        },
        error: msg,
      });
    }

    // --- Pull fresh statuses from Twilio where possible ---
    let brandStatus = "unknown";
    let brandFailureReason: string | null = null;
    let brandErrors: any[] = [];
    let brandErrorsText = "";

    // ✅ Track whether Twilio *explicitly* says this is failed (this is the only thing that should drive "declined")
    let twilioBrandFailed = false;
    let twilioCampaignFailed = false;

    if (a2p.brandSid) {
      try {
        const brand: any = await client.messaging.v1.brandRegistrations(a2p.brandSid).fetch();
        brandStatus = String((brand as any).status || brandStatus);

        // capture failure reason(s)
        const rawFailure =
          brand?.failureReason ||
          brand?.failureReasons ||
          brand?.errors ||
          brand?.errorCodes ||
          undefined;

        if (typeof rawFailure === "string") {
          brandFailureReason = rawFailure;
        } else if (Array.isArray(rawFailure)) {
          try {
            brandFailureReason = rawFailure
              .map((x) =>
                typeof x === "string"
                  ? x
                  : typeof x === "object"
                  ? JSON.stringify(x)
                  : String(x),
              )
              .join("; ");
          } catch {
            brandFailureReason = String(rawFailure);
          }
        } else if (rawFailure) {
          try {
            brandFailureReason = JSON.stringify(rawFailure);
          } catch {
            brandFailureReason = String(rawFailure);
          }
        } else {
          brandFailureReason = null;
        }

        // capture errors array (Twilio often uses .errors)
        brandErrors = Array.isArray(brand?.errors) ? brand.errors : [];
        brandErrorsText = flattenErrorsText(brandErrors);

        (a2p as any).brandStatus = brandStatus;
        (a2p as any).brandFailureReason = brandFailureReason || undefined;
        (a2p as any).brandErrors = brandErrors.length ? brandErrors : undefined;
        (a2p as any).brandErrorsText = brandErrorsText || undefined;

        const lower = safeLower(brandStatus);

        if (FAILED.has(lower)) {
          twilioBrandFailed = true;

          a2p.registrationStatus = "rejected";
          a2p.messagingReady = false;

          // ✅ set declinedReason to the REAL reason if we have one
          const realReason =
            brandErrorsText ||
            brandFailureReason ||
            "Brand rejected. Please review and resubmit.";

          a2p.declinedReason = realReason;
          (a2p as any).applicationStatus = "declined";
        } else if (APPROVED.has(lower)) {
          a2p.registrationStatus = "brand_approved";

          // ✅ IMPORTANT: if Twilio says approved, clear stale decline flags
          a2p.declinedReason = null;
          (a2p as any).applicationStatus = "pending";
        } else if (PENDING.has(lower)) {
          a2p.registrationStatus = "brand_submitted";

          // ✅ IMPORTANT: if Twilio says pending, clear stale decline flags
          a2p.declinedReason = null;
          (a2p as any).applicationStatus = "pending";
        }
      } catch {
        // best-effort
      }
    }

    let campaignStatus = "unknown";
    const campaignSid = (a2p as any).usa2pSid || (a2p as any).campaignSid;

    if (a2p.messagingServiceSid && campaignSid) {
      try {
        const camp = await client.messaging.v1
          .services(a2p.messagingServiceSid)
          .usAppToPerson(campaignSid)
          .fetch();

        campaignStatus = String((camp as any).status || (camp as any).state || campaignStatus);

        const lower = safeLower(campaignStatus);

        if (FAILED.has(lower)) {
          twilioCampaignFailed = true;

          a2p.registrationStatus = "rejected";
          a2p.messagingReady = false;

          // Only set declinedReason if Twilio explicitly failed and we don't already have one
          if (!a2p.declinedReason) {
            a2p.declinedReason =
              "Your A2P campaign registration was rejected by carriers. Please review your use case description, sample messages, and opt-in/opt-out details, then resubmit.";
          }
        } else if (APPROVED.has(lower)) {
          a2p.registrationStatus = "campaign_approved";
          a2p.messagingReady = true;

          // ✅ clear stale decline flags if campaign approved
          a2p.declinedReason = null;
        } else if (PENDING.has(lower)) {
          a2p.registrationStatus = "campaign_submitted";

          // ✅ clear stale decline flags if campaign pending
          a2p.declinedReason = null;
        }
      } catch {
        // best-effort
      }
    }

    // --- Fetch senders attached to the Messaging Service (phone numbers) ---
    let senders: Array<{
      phoneNumberSid: string;
      phoneNumber?: string | null;
      attached: boolean;
      a2pReady: boolean;
    }> = [];

    if (a2p.messagingServiceSid) {
      try {
        const attached = await client.messaging.v1
          .services(a2p.messagingServiceSid)
          .phoneNumbers.list({ limit: 100 });

        const pnSids = attached.map((p: any) => p.phoneNumberSid).filter(Boolean);

        if (pnSids.length) {
          const pnDetails = await Promise.all(
            pnSids.map((sid: string) =>
              client.incomingPhoneNumbers(sid).fetch().then(
                (d: any) => ({ sid, phoneNumber: d?.phoneNumber || null }),
                () => ({ sid, phoneNumber: null }),
              ),
            ),
          );

          const phoneBySid = new Map(pnDetails.map((d) => [d.sid, d.phoneNumber]));

          senders = attached.map((p: any) => ({
            phoneNumberSid: p.phoneNumberSid,
            phoneNumber: phoneBySid.get(p.phoneNumberSid) ?? null,
            attached: true,
            a2pReady: Boolean(a2p.messagingReady),
          }));
        }
      } catch {
        // ignore
      }
    }

    // --- Derive applicationStatus ---
    a2p.lastSyncedAt = new Date();
    (a2p as any).twilioAccountSidLastUsed = twilioAccountSidUsed || undefined;

    // ✅ FIX: ONLY treat as declined if Twilio explicitly returned FAILED on brand or campaign.
    // DO NOT mark declined just because DB has stale registrationStatus/declinedReason.
    let applicationStatus = "pending";

    if (twilioBrandFailed || twilioCampaignFailed) {
      applicationStatus = "declined";
      a2p.messagingReady = false;
      (a2p as any).applicationStatus = "declined";
    } else if (
      a2p.messagingReady ||
      a2p.registrationStatus === "ready" ||
      a2p.registrationStatus === "campaign_approved"
    ) {
      applicationStatus = "approved";
      (a2p as any).applicationStatus = "approved";
    } else {
      applicationStatus = "pending";
      (a2p as any).applicationStatus = "pending";
    }

    // If Twilio did NOT fail and we are pending/approved, ensure no stale decline reason is returned
    if (applicationStatus !== "declined") {
      a2p.declinedReason = null;
    }

    try {
      await (a2p as any).save({ validateBeforeSave: false });
    } catch (e: any) {
      console.warn("[A2P status] non-fatal: failed to persist status snapshot", {
        message: e?.message,
      });
    }

    // --- Decide next action for the wizard/UI ---
    const lowerBrand = safeLower(brandStatus);
    const lowerCampaign = safeLower(campaignStatus);
    const brandFailed = Boolean(a2p.brandSid && FAILED.has(lowerBrand));
    const campaignFailed = Boolean(campaignSid && FAILED.has(lowerCampaign));

    let nextAction: NextAction = "ready";

    if (!(a2p as any).profileSid) {
      nextAction = "start_profile";
    } else if (!a2p.brandSid || brandFailed) {
      nextAction = "submit_brand";
    } else if (a2p.brandSid && !APPROVED.has(lowerBrand)) {
      nextAction = "brand_pending";
    } else if (!campaignSid || campaignFailed) {
      nextAction = "submit_campaign";
    } else if (campaignSid && !APPROVED.has(lowerCampaign)) {
      nextAction = "campaign_pending";
    } else if (!a2p.messagingServiceSid) {
      nextAction = "create_messaging_service";
    } else {
      nextAction = "ready";
    }

    const canSendSms = Boolean(a2p.messagingReady && a2p.messagingServiceSid);

    const a2pStatusLabel =
      applicationStatus === "approved"
        ? "Approved"
        : applicationStatus === "declined"
        ? "Declined"
        : "Pending";

    return res.status(200).json({
      nextAction,
      registrationStatus: a2p.registrationStatus || "unknown",
      messagingReady: Boolean(a2p.messagingReady),
      canSendSms,
      applicationStatus,
      a2pStatusLabel,
      declinedReason: applicationStatus === "declined" ? a2p.declinedReason || null : null,
      brand: {
        sid: a2p.brandSid || null,
        status: brandStatus,
        failureReason: brandFailureReason || null,
        errorsText: brandErrorsText || null,
      },
      campaign: { sid: campaignSid || null, status: campaignStatus },
      messagingServiceSid: a2p.messagingServiceSid || null,
      senders,
      hints: {
        hasProfile: Boolean((a2p as any).profileSid),
        hasBrand: Boolean(a2p.brandSid),
        hasCampaign: Boolean(campaignSid),
        hasMessagingService: Boolean(a2p.messagingServiceSid),
      },
      twilioAccountSidUsed,
    });
  } catch (err: any) {
    console.error("A2P status error:", err);
    return res.status(500).json({ message: err?.message || "Failed to fetch A2P status" });
  }
}
