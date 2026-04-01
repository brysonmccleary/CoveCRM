// pages/api/meta/sync-insights.ts
// POST — Sync Meta Ad Insights for current user
// GET  — Return last sync info
// POST action=save-assets — persist selected page/ad account for current user

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { syncAdInsights } from "@/lib/meta/syncAdInsights";

const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";

async function fetchPageMeta(token: string, pageId: string) {
  if (!token || !pageId) {
    return {};
  }
  try {
    const url = new URL(`${META_GRAPH_BASE}/${pageId}`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("fields", "id,name,instagram_business_account{id}");
    const resp = await fetch(url.toString());
    const data = await resp.json() as any;
    if (!resp.ok) return {};
    return {
      metaPageName: String(data?.name || ""),
      metaInstagramId: String(data?.instagram_business_account?.id || ""),
    };
  } catch {
    return {};
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const user = await User.findOne({ email }).lean() as any;
  if (!user) return res.status(404).json({ error: "User not found" });

  if (req.method === "GET") {
    return res.status(200).json({
      connected: !!(user.metaAdAccountId && (user.metaAccessToken || user.metaSystemUserToken)),
      pageId: user.metaPageId || "",
      pageName: user.metaPageName || "",
      adAccountId: user.metaAdAccountId || "",
      tokenExpiresAt: user.metaTokenExpiresAt || null,
      lastSyncAt: user.metaLastInsightSyncAt || null,
      lastWebhookAt: user.metaLastWebhookAt || null,
    });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const action = String(body?.action || "");
    const token = user.metaSystemUserToken || user.metaAccessToken || "";

    if (action === "save-assets") {
      const pageId = String(body?.pageId || "").trim();
      const adAccountId = String(body?.adAccountId || "").trim();

      if (!pageId && !adAccountId) {
        return res.status(400).json({ error: "No pageId or adAccountId provided" });
      }

      const pageMeta = pageId && token ? await fetchPageMeta(token, pageId) : {};
      const update: Record<string, any> = {};

      if (pageId) update.metaPageId = pageId;
      if (adAccountId) update.metaAdAccountId = adAccountId.replace(/^act_/, "");
      if (pageMeta.metaPageName) update.metaPageName = pageMeta.metaPageName;
      if (pageMeta.metaInstagramId) update.metaInstagramId = pageMeta.metaInstagramId;

      await User.updateOne({ email }, { $set: update });

      const refreshed = await User.findOne({ email }).lean() as any;
      return res.status(200).json({
        ok: true,
        saved: {
          pageId: refreshed?.metaPageId || "",
          pageName: refreshed?.metaPageName || "",
          adAccountId: refreshed?.metaAdAccountId || "",
          instagramId: refreshed?.metaInstagramId || "",
        },
      });
    }

    const adAccountId = user.metaAdAccountId;
    if (!adAccountId || !token) {
      return res.status(400).json({
        error: "Meta Ad Account not connected. Connect your Meta account in settings first.",
      });
    }

    const days = parseInt(String(req.query.days || body?.days || "7"), 10);

    try {
      const result = await syncAdInsights(
        String(user._id),
        email,
        adAccountId,
        token,
        days
      );
      return res.status(200).json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[sync-insights] Error:", err?.message);
      return res.status(500).json({ error: err?.message || "Sync failed" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
