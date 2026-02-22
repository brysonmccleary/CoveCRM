// /pages/api/a2p/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

// Brand statuses that indicate brand approved (NOT texting-ready)
const BRAND_APPROVED = new Set(["approved", "verified", "active", "in_use", "registered"]);
const BRAND_PENDING = new Set(["pending", "submitted", "under_review", "pending-review", "in_progress"]);
const BRAND_FAILED = new Set(["failed", "rejected", "declined", "terminated", "brand_failed"]);

// Campaign statuses that indicate campaign approved (texting-ready)
const CAMPAIGN_APPROVED = new Set(["approved", "verified", "active", "in_use", "registered", "campaign_approved"]);
const CAMPAIGN_PENDING = new Set([
  "pending",
  "submitted",
  "under_review",
  "pending-review",
  "in_progress",
  "campaign_submitted",
]);
const CAMPAIGN_FAILED = new Set(["failed", "rejected", "declined", "terminated", "campaign_failed"]);

type NextAction =
  | "start_profile"
  | "submit_brand"
  | "brand_pending"
  | "create_messaging_service"
  | "submit_campaign"
  | "campaign_pending"
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
            (brands || []).map((b: any) => ({ sid: b?.sid, status: b?.status }))
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
        messagingReady: false, // ✅ never claim ready if we couldn't verify campaign status
        canSendSms: false,
        applicationStatus: "pending", // ✅ never approved on error path
        a2pStatusLabel: "Pending",
        declinedReason: (a2p as any).declinedReason || null,
        brand: {
          sid: (a2p as any).brandSid || null,
          status: (a2p as any).brandStatus || "unknown",
        },
        campaign: {
          sid: (a2p as any).usa2pSid || (a2p as any).campaignSid || null,
          status: "unknown",
        },
        messagingServiceSid: (a2p as any).messagingServiceSid || null,
        senders: [],
        hints: {
          hasProfile: Boolean((a2p as any).profileSid),
          hasBrand: Boolean((a2p as any).brandSid),
          hasCampaign: Boolean((a2p as any).usa2pSid || (a2p as any).campaignSid),
          hasMessagingService: Boolean((a2p as any).messagingServiceSid),
        },
        error: msg,
      });
    }

    // --- Pull fresh statuses from Twilio where possible ---
    let brandStatus = "unknown";
    let brandFailureReason: string | null = null;
    let brandErrors: any[] = [];
    let brandErrorsText = "";

    if ((a2p as any).brandSid) {
      try {
        const brand: any = await client.messaging.v1
          .brandRegistrations((a2p as any).brandSid)
          .fetch();

        brandStatus = String((brand as any).status || brandStatus);

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
                  : String(x)
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

        brandErrors = Array.isArray(brand?.errors) ? brand.errors : [];
        brandErrorsText = flattenErrorsText(brandErrors);

        (a2p as any).brandStatus = brandStatus;
        (a2p as any).brandFailureReason = brandFailureReason || undefined;
        (a2p as any).brandErrors = brandErrors.length ? brandErrors : undefined;
        (a2p as any).brandErrorsText = brandErrorsText || undefined;

        const lower = safeLower(brandStatus);

        if (BRAND_FAILED.has(lower)) {
          (a2p as any).registrationStatus = "rejected";
          (a2p as any).messagingReady = false;

          const realReason =
            brandErrorsText ||
            brandFailureReason ||
            "Brand rejected. Please review and resubmit.";

          (a2p as any).declinedReason = realReason;
          (a2p as any).applicationStatus = "declined";
        } else if (BRAND_APPROVED.has(lower)) {
          (a2p as any).registrationStatus = "brand_approved";
          (a2p as any).declinedReason = undefined;
          (a2p as any).applicationStatus = "pending";
        } else if (BRAND_PENDING.has(lower)) {
          (a2p as any).registrationStatus = "brand_submitted";
        }
      } catch {
        // best-effort
      }
    }

    // --- Campaign status (this controls "approved/live") ---
    let campaignStatus = "unknown";
    const campaignSid = (a2p as any).usa2pSid || (a2p as any).campaignSid;
    let campaignStatusFetched = false; // ✅ NEW: track whether we actually verified campaign status

    if ((a2p as any).messagingServiceSid && campaignSid) {
      try {
        const camp = await client.messaging.v1
          .services((a2p as any).messagingServiceSid)
          .usAppToPerson(campaignSid)
          .fetch();

        campaignStatus = String((camp as any).campaignStatus || (camp as any).campaign_status || (camp as any).status || (camp as any).state || campaignStatus);
        campaignStatusFetched = true;

        const lower = safeLower(campaignStatus);

        if (CAMPAIGN_FAILED.has(lower)) {
          (a2p as any).registrationStatus = "rejected";
          (a2p as any).messagingReady = false;

          if (!(a2p as any).declinedReason) {
            (a2p as any).declinedReason =
              "Your A2P campaign registration was rejected by carriers. Please review your use case description, sample messages, and opt-in/opt-out details, then resubmit.";
          }

          (a2p as any).applicationStatus = "declined";
        } else if (CAMPAIGN_APPROVED.has(lower)) {
          (a2p as any).registrationStatus = "campaign_approved";
          (a2p as any).messagingReady = true;
          (a2p as any).declinedReason = undefined;
          (a2p as any).applicationStatus = "approved";
        } else if (CAMPAIGN_PENDING.has(lower)) {
          (a2p as any).registrationStatus = "campaign_submitted";
          (a2p as any).messagingReady = false;
          (a2p as any).applicationStatus = "pending";
        } else {
          // ✅ NEW: unknown campaign state => never treat as approved
          (a2p as any).messagingReady = false;
          (a2p as any).applicationStatus = "pending";
        }
      } catch {
        // ✅ NEW: fetch failed => we did NOT verify approval => never treat as approved
        campaignStatusFetched = false;
      }
    }

    // --- Fetch senders attached to the Messaging Service (phone numbers) ---
    let senders: Array<{
      phoneNumberSid: string;
      phoneNumber?: string | null;
      attached: boolean;
      a2pReady: boolean;
    }> = [];

    if ((a2p as any).messagingServiceSid) {
      try {
        const attached = await client.messaging.v1
          .services((a2p as any).messagingServiceSid)
          .phoneNumbers.list({ limit: 100 });

        const pnSids = attached.map((p: any) => p.phoneNumberSid).filter(Boolean);

        if (pnSids.length) {
          const pnDetails = await Promise.all(
            pnSids.map((sid: string) =>
              client.incomingPhoneNumbers(sid).fetch().then(
                (d: any) => ({ sid, phoneNumber: d?.phoneNumber || null }),
                () => ({ sid, phoneNumber: null })
              )
            )
          );

          const phoneBySid = new Map(pnDetails.map((d) => [d.sid, d.phoneNumber]));

          senders = attached.map((p: any) => ({
            phoneNumberSid: p.phoneNumberSid,
            phoneNumber: phoneBySid.get(p.phoneNumberSid) ?? null,
            attached: true,
            a2pReady: Boolean((a2p as any).messagingReady),
          }));
        }
      } catch {
        // ignore
      }
    }

    // --- Derive applicationStatus (FIXED semantics) ---
    (a2p as any).lastSyncedAt = new Date();
    (a2p as any).twilioAccountSidLastUsed = twilioAccountSidUsed || undefined;

    const isRejected =
      (a2p as any).registrationStatus === "rejected" ||
      Boolean((a2p as any).declinedReason);

    let applicationStatus = "pending";

    if (isRejected) {
      applicationStatus = "declined";
      (a2p as any).messagingReady = false;
    } else {
      // ✅ CRITICAL: approved only if we VERIFIED campaign approval this request
      const lowerCampaign = safeLower(campaignStatus);
      const verifiedCampaignApproved =
        Boolean(campaignSid) && campaignStatusFetched && CAMPAIGN_APPROVED.has(lowerCampaign);

      if (verifiedCampaignApproved) {
        (a2p as any).messagingReady = true;
        applicationStatus = "approved";
      } else {
        // If we didn't verify approval (or it isn't approved), force pending + not-ready
        (a2p as any).messagingReady = false;
        applicationStatus = "pending";
      }
    }

    (a2p as any).applicationStatus = applicationStatus;

    try {
      await (a2p as any).save({ validateBeforeSave: false });
    } catch (e: any) {
      console.warn("[A2P status] non-fatal: failed to persist status snapshot", {
        message: e?.message,
      });
    }

    // --- Decide next action for the wizard/UI (FIXED ordering) ---
    const lowerBrand = safeLower(brandStatus);
    const lowerCampaign = safeLower(campaignStatus);

    const brandFailed = Boolean((a2p as any).brandSid && BRAND_FAILED.has(lowerBrand));
    const campaignFailed = Boolean(campaignSid && CAMPAIGN_FAILED.has(lowerCampaign));

    let nextAction: NextAction = "ready";

    if (!(a2p as any).profileSid) {
      nextAction = "start_profile";
    } else if (!(a2p as any).brandSid || brandFailed) {
      nextAction = "submit_brand";
    } else if ((a2p as any).brandSid && !BRAND_APPROVED.has(lowerBrand)) {
      nextAction = "brand_pending";
    } else if (!(a2p as any).messagingServiceSid) {
      // ✅ before campaign submit
      nextAction = "create_messaging_service";
    } else if (!campaignSid || campaignFailed) {
      nextAction = "submit_campaign";
    } else if (campaignSid && !CAMPAIGN_APPROVED.has(lowerCampaign)) {
      nextAction = "campaign_pending";
    } else {
      nextAction = "ready";
    }

    const canSendSms = Boolean((a2p as any).messagingReady && (a2p as any).messagingServiceSid);

    const a2pStatusLabel =
      applicationStatus === "approved"
        ? "Approved"
        : applicationStatus === "declined"
        ? "Declined"
        : "Pending";

    return res.status(200).json({
      nextAction,
      registrationStatus: (a2p as any).registrationStatus || "unknown",
      messagingReady: Boolean((a2p as any).messagingReady),
      canSendSms,
      applicationStatus,
      a2pStatusLabel,
      declinedReason: (a2p as any).declinedReason || null,
      brand: {
        sid: (a2p as any).brandSid || null,
        status: brandStatus,
        failureReason: brandFailureReason || null,
        errorsText: brandErrorsText || null,
      },
      campaign: { sid: campaignSid || null, status: campaignStatus },
      messagingServiceSid: (a2p as any).messagingServiceSid || null,
      senders,
      hints: {
        hasProfile: Boolean((a2p as any).profileSid),
        hasBrand: Boolean((a2p as any).brandSid),
        hasCampaign: Boolean(campaignSid),
        hasMessagingService: Boolean((a2p as any).messagingServiceSid),
      },
      twilioAccountSidUsed,
    });
  } catch (err: any) {
    console.error("A2P status error:", err);
    return res.status(500).json({
      message: err?.message || "Failed to fetch A2P status",
    });
  }
}
