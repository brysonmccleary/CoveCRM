import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { metaGraphUrl } from "@/lib/meta/graphApi";
import {
  chooseSetupAdAccount,
  chooseSetupPage,
  mapMetaAdAccounts,
  mapMetaPages,
} from "@/lib/meta/setupAssets";

async function graphGet(path: string, token: string, fields: string) {
  const url = new URL(metaGraphUrl(path));
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", "200");
  const response = await fetch(url.toString());
  const json = await response.json() as any;
  if (!response.ok) {
    const error = new Error(String(json?.error?.message || "Facebook setup could not be refreshed")) as Error & { code?: number };
    error.code = Number(json?.error?.code || 0);
    throw error;
  }
  return json;
}

async function subscribeToLeads(pageId: string, pageAccessToken: string) {
  if (!pageId || !pageAccessToken) return false;
  const response = await fetch(metaGraphUrl(`${pageId}/subscribed_apps`), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      subscribed_fields: "leadgen",
      access_token: pageAccessToken,
    }).toString(),
  });
  const json = await response.json() as any;
  return response.ok && json?.success === true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const user = await User.findOne({ email }).lean() as any;
  const token = String(user?.metaSystemUserToken || user?.metaAccessToken || "");
  if (!token) return res.status(200).json({ connected: false, ready: false });

  try {
    const [pagesResult, accountsResult] = await Promise.allSettled([
      graphGet(
        "me/accounts",
        token,
        "id,name,access_token,category,link,tasks,picture.type(large){url},instagram_business_account{id}"
      ),
      graphGet("me/adaccounts", token, "id,name,account_id,account_status,currency"),
    ]);
    if (pagesResult.status === "rejected" && accountsResult.status === "rejected") {
      throw pagesResult.reason;
    }
    const pages = mapMetaPages(pagesResult.status === "fulfilled" ? pagesResult.value?.data : []);
    const adAccounts = mapMetaAdAccounts(accountsResult.status === "fulfilled" ? accountsResult.value?.data : []);
    const preferNewPage = req.body?.preferNewPage === true;
    const knownPageIds = Array.isArray(req.body?.knownPageIds)
      ? req.body.knownPageIds.map((id: unknown) => String(id || "")).filter(Boolean)
      : [];
    const requestedPageId = String(req.body?.pageId || "").trim();
    const requestedAccountId = String(req.body?.adAccountId || "").replace(/^act_/, "").trim();
    if (requestedPageId && !pages.some((page) => page.id === requestedPageId)) {
      return res.status(400).json({ error: "That Facebook Page is no longer available. Refresh and try again." });
    }
    if (requestedAccountId && !adAccounts.some((account) => account.accountId === requestedAccountId)) {
      return res.status(400).json({ error: "That Facebook ad account is no longer available. Refresh and try again." });
    }
    let selectedPage = requestedPageId
      ? pages.find((page) => page.id === requestedPageId) || null
      : chooseSetupPage(pages, String(user?.metaPageId || ""), preferNewPage, knownPageIds);
    let selectedAdAccount = requestedAccountId
      ? adAccounts.find((account) => account.accountId === requestedAccountId) || null
      : chooseSetupAdAccount(adAccounts, String(user?.metaAdAccountId || ""));
    if (!selectedPage && pagesResult.status === "rejected" && user?.metaPageId) {
      selectedPage = { id: String(user.metaPageId), name: String(user.metaPageName || "Facebook Page") };
    }
    if (!selectedAdAccount && accountsResult.status === "rejected" && user?.metaAdAccountId) {
      const accountId = String(user.metaAdAccountId).replace(/^act_/, "");
      selectedAdAccount = { id: `act_${accountId}`, accountId, name: "Facebook ad account" };
    }

    const update: Record<string, any> = {
      metaHealthStatus: "unknown",
      lastMetaHealthError: "",
      metaHealthCooldownUntil: null,
      metaReconnectNeeded: false,
    };
    if (selectedPage) {
      update.metaPageId = selectedPage.id;
      update.metaPageName = selectedPage.name;
      if (selectedPage.accessToken) update.metaPageAccessToken = selectedPage.accessToken;
      if (selectedPage.instagramId) update.metaInstagramId = selectedPage.instagramId;
    }
    if (selectedAdAccount) update.metaAdAccountId = selectedAdAccount.accountId;

    const leadType = String(req.body?.leadType || "").trim();
    if (leadType && selectedPage && selectedAdAccount) {
      update[`metaLeadTypeAssets.${leadType}`] = {
        pageId: selectedPage.id,
        pageName: selectedPage.name,
        adAccountId: selectedAdAccount.accountId,
        updatedAt: new Date(),
      };
    }

    if (selectedPage || selectedAdAccount) {
      const savedUser = await User.findOneAndUpdate(
        { email },
        { $set: update },
        { new: true }
      ).select("metaPageId metaAdAccountId").lean() as any;
      if (selectedPage && String(savedUser?.metaPageId || "") !== selectedPage.id) {
        throw new Error("Facebook Page selection did not save");
      }
      if (selectedAdAccount && String(savedUser?.metaAdAccountId || "").replace(/^act_/, "") !== selectedAdAccount.accountId) {
        throw new Error("Facebook ad account selection did not save");
      }
    }

    let leadDeliveryReady = false;
    if (selectedPage?.accessToken) {
      leadDeliveryReady = await subscribeToLeads(selectedPage.id, selectedPage.accessToken).catch(() => false);
    }

    const ready = Boolean(selectedPage && selectedAdAccount);
    return res.status(200).json({
      connected: true,
      ready,
      leadDeliveryReady,
      page: selectedPage ? { ...selectedPage, accessToken: undefined } : null,
      adAccount: selectedAdAccount,
      pages: pages.map((page) => ({
        id: page.id,
        name: page.name,
        instagramId: page.instagramId,
        pictureUrl: page.pictureUrl,
        category: page.category,
        link: page.link,
        tasks: page.tasks,
      })),
      adAccounts,
      needsPageChoice: !selectedPage && pages.length > 1,
      needsAdAccountChoice: !selectedAdAccount && adAccounts.length > 1,
      pageRefreshAvailable: pagesResult.status === "fulfilled",
      adAccountRefreshAvailable: accountsResult.status === "fulfilled",
    });
  } catch (error: any) {
    console.error("[meta/refresh-setup]", error?.message);
    if (Number(error?.code || 0) === 190) {
      await User.updateOne(
        { email },
        { $set: { metaReconnectNeeded: true, metaHealthStatus: "reconnectNeeded" } }
      ).catch(() => {});
      return res.status(200).json({
        connected: false,
        ready: false,
        reconnectNeeded: true,
      });
    }
    return res.status(502).json({
      connected: true,
      ready: false,
      error: "Facebook could not be refreshed right now. Please try again.",
    });
  }
}
