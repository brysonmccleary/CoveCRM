import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import ProvenAd from "@/models/ProvenAd";

function buildSearchableText(payload: any) {
  return [
    payload?.title || "",
    payload?.sourceBrand || "",
    payload?.leadType || "",
    payload?.format || "",
    payload?.audience || "",
    ...(Array.isArray(payload?.angleTags) ? payload.angleTags : []),
    payload?.hookType || "",
    payload?.headline || "",
    payload?.primaryText || "",
    payload?.description || "",
    payload?.transcript || "",
    payload?.visualNotes || "",
    payload?.landingPageNotes || "",
    payload?.whyItWorks || "",
    payload?.cloneNotes || "",
  ]
    .join(" \n ")
    .toLowerCase()
    .trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  if (req.method === "GET") {
    const {
      q = "",
      leadType = "",
      format = "",
      sourceBrand = "",
      includeGlobal = "true",
      limit = "100",
    } = req.query as Record<string, string>;

    const userEmail = session.user.email.toLowerCase();
    const orScopes: any[] = [{ userEmail }];

    if (includeGlobal === "true") {
      orScopes.push({ scope: "global" });
    }

    const filter: any = { $or: orScopes };

    if (leadType) filter.leadType = leadType;
    if (format) filter.format = format;
    if (sourceBrand) filter.sourceBrand = new RegExp(sourceBrand, "i");

    if (q?.trim()) {
      filter.$and = [
        ...(filter.$and || []),
        {
          searchableText: { $regex: q.trim().toLowerCase(), $options: "i" },
        },
      ];
    }

    const docs = await ProvenAd.find(filter)
      .sort({ likelyWinnerScore: -1, createdAt: -1 })
      .limit(Math.max(1, Math.min(250, Number(limit) || 100)))
      .lean();

    return res.status(200).json({ ads: docs });
  }

  if (req.method === "POST") {
    const user = await User.findOne({ email: session.user.email.toLowerCase() }).select("_id email").lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    const payload = req.body || {};

    if (!payload.title || !payload.leadType) {
      return res.status(400).json({ error: "title and leadType are required" });
    }

    const doc = await ProvenAd.create({
      userId: (user as any)._id,
      userEmail: session.user.email.toLowerCase(),
      scope: payload.scope === "global" ? "global" : "user",
      sourceBrand: payload.sourceBrand || "",
      sourceType: payload.sourceType || "manual",
      sourceUrl: payload.sourceUrl || "",
      title: payload.title,
      leadType: payload.leadType,
      format: payload.format || "unknown",
      angleTags: Array.isArray(payload.angleTags) ? payload.angleTags : [],
      hookType: payload.hookType || "",
      audience: payload.audience || "",
      primaryText: payload.primaryText || "",
      headline: payload.headline || "",
      description: payload.description || "",
      cta: payload.cta || "",
      transcript: payload.transcript || "",
      visualNotes: payload.visualNotes || "",
      landingPageType: payload.landingPageType || "unknown",
      funnelSteps: Array.isArray(payload.funnelSteps) ? payload.funnelSteps : [],
      landingPageNotes: payload.landingPageNotes || "",
      whyItWorks: payload.whyItWorks || "",
      complianceNotes: payload.complianceNotes || "",
      screenshotUrls: Array.isArray(payload.screenshotUrls) ? payload.screenshotUrls : [],
      assetUrls: Array.isArray(payload.assetUrls) ? payload.assetUrls : [],
      cloneNotes: payload.cloneNotes || "",
      likelyWinnerScore: Number(payload.likelyWinnerScore || 0),
      isSeeded: !!payload.isSeeded,
      searchableText: buildSearchableText(payload),
    });

    return res.status(201).json({ ok: true, ad: doc });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
