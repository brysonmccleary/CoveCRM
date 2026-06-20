// pages/api/a2p/hosted-compliance.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { buildLeadGenerationConsentText } from "@/lib/a2p/flowSelection";

type ComplianceLinks = { optInUrl: string; tosUrl: string; privacyUrl: string };

type Resp =
  | {
      optInUrl: string;
      tosUrl: string;
      privacyUrl: string;
      selectedFlow: "lead_generation";
      leadGeneration: ComplianceLinks;
      servicing: ComplianceLinks;
    }
  | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email || !session?.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    ((req.headers["referer"] as string)?.startsWith("https://") ? "https" : "http") ||
    "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers["host"] as string) ||
    "";
  const baseUrl = host ? `${proto}://${host}` : "https://www.covecrm.com";
  const rawUserId = String((session.user as any).id || "");

  const tosUrl = `${baseUrl}/sms/lead-optin-terms/${rawUserId}`;
  const privacyUrl = `${baseUrl}/sms/lead-optin-privacy/${rawUserId}`;
  const servicing: ComplianceLinks = {
    optInUrl: `${baseUrl}/sms/optin/${rawUserId}`,
    tosUrl: `${baseUrl}/sms/optin-terms/${rawUserId}`,
    privacyUrl: `${baseUrl}/sms/optin-privacy/${rawUserId}`,
  };

  try {
    await mongooseConnect();

    let user: any = null;
    try {
      if (rawUserId) {
        user = await (User as any).findById(rawUserId).select("_id").lean();
      }
    } catch {}
    if (!user?._id) {
      user = await (User as any).findOne({ email: session.user.email }).select("_id").lean();
    }

    if (!user?._id) {
      const fallbackOptIn = `${baseUrl}/sms/lead-optin/${rawUserId}`;
      const leadGeneration: ComplianceLinks = { optInUrl: fallbackOptIn, tosUrl, privacyUrl };
      return res.status(200).json({ ...leadGeneration, selectedFlow: "lead_generation", leadGeneration, servicing });
    }

    const userId = String(user._id);

    const a2pProfile = await (A2PProfile as any)
      .findOne({ userId })
      .select("contactFirstName contactLastName businessName phone")
      .lean() as any;

    const agentName =
      [
        String(a2pProfile?.contactFirstName || "").trim(),
        String(a2pProfile?.contactLastName || "").trim(),
      ]
        .filter(Boolean)
        .join(" ");
    const businessName = String(a2pProfile?.businessName || "").trim();
    const agentPhone = String(a2pProfile?.phone || "").trim();

    const consentText = buildLeadGenerationConsentText({
      agentName,
      businessName,
      campaignType: "final_expense",
    });

    const stub = await (FBLeadCampaign as any).findOneAndUpdate(
      { userEmail: session.user.email, funnelVersion: "a2p-compliance-stub" },
      {
        $setOnInsert: {
          userId: user._id,
          leadType: "final_expense",
          campaignName: "A2P Compliance Review",
          status: "active",
          webhookKey: Math.random().toString(36).substring(2, 12),
        },
        $set: {
          funnelStatus: "active",
          licensedStates: [],
          borderStateBehavior: "allow_with_warning",
          publicAgentProfile: {
            displayName: agentName,
            businessName,
            phone: agentPhone,
            stateLabel: "",
            logoUrl: "",
            headshotUrl: "",
          },
          complianceProfile: {
            consentText,
            disclaimerText: "",
            privacyUrl,
            termsUrl: tosUrl,
          },
        },
      },
      { upsert: true, returnDocument: "after" },
    ) as any;

    const stubId = String(stub?._id || "");
    if (!stubId) throw new Error("stub upsert returned no _id");

    const optInUrl = `${baseUrl}/f/${stubId}`;
    const leadGeneration: ComplianceLinks = { optInUrl, tosUrl, privacyUrl };
    return res.status(200).json({
      ...leadGeneration,
      selectedFlow: "lead_generation",
      leadGeneration,
      servicing,
    });
  } catch (err: any) {
    console.error("[hosted-compliance] error:", err?.message);
    const fallbackOptIn = `${baseUrl}/sms/lead-optin/${rawUserId}`;
    const leadGeneration: ComplianceLinks = { optInUrl: fallbackOptIn, tosUrl, privacyUrl };
    return res.status(200).json({ ...leadGeneration, selectedFlow: "lead_generation", leadGeneration, servicing });
  }
}
