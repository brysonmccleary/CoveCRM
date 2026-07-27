// pages/api/meta/callback.ts
// GET — Handle OAuth callback from Meta, exchange code for long-lived token

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { metaGraphUrl } from "@/lib/meta/graphApi";
import { chooseSetupAdAccount, chooseSetupPage, mapMetaAdAccounts, mapMetaPages } from "@/lib/meta/setupAssets";
import { verifyMetaOauthState } from "@/lib/meta/oauthState";

const META_APP_ID = process.env.META_APP_ID || "";
const META_APP_SECRET = process.env.META_APP_SECRET || "";
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { code, error: oauthError, state } = req.query as { code?: string; error?: string; state?: string };

  if (oauthError) {
    console.warn("[meta/callback] OAuth error:", oauthError);
    return res.redirect(`${BASE_URL}/facebook-leads?meta=error&reason=${encodeURIComponent(oauthError)}`);
  }

  if (!code) {
    return res.redirect(`${BASE_URL}/facebook-leads?meta=error&reason=no_code`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.redirect(`${BASE_URL}/auth/signin`);
  }

  const userEmail = session.user.email.toLowerCase();
  const expectedState = String((session.user as any).id || session.user.email);
  if (!verifyMetaOauthState(String(state || ""), expectedState, META_APP_SECRET)) {
    return res.redirect(`${BASE_URL}/facebook-leads?meta=error&reason=invalid_state`);
  }
  const redirectUri = `${BASE_URL}/api/meta/callback`;

  try {
    const tokenUrl = new URL(metaGraphUrl("oauth/access_token"));
    tokenUrl.searchParams.set("client_id", META_APP_ID);
    tokenUrl.searchParams.set("client_secret", META_APP_SECRET);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);

    const tokenResp = await fetch(tokenUrl.toString());
    const tokenData = await tokenResp.json() as any;

    if (!tokenData.access_token) {
      console.error("[meta/callback] Token exchange failed:", tokenData);
      return res.redirect(`${BASE_URL}/facebook-leads?meta=error&reason=token_exchange`);
    }

    const shortLivedToken = tokenData.access_token;

    const llUrl = new URL(metaGraphUrl("oauth/access_token"));
    llUrl.searchParams.set("grant_type", "fb_exchange_token");
    llUrl.searchParams.set("client_id", META_APP_ID);
    llUrl.searchParams.set("client_secret", META_APP_SECRET);
    llUrl.searchParams.set("fb_exchange_token", shortLivedToken);

    const llResp = await fetch(llUrl.toString());
    const llData = await llResp.json() as any;

    const longLivedToken = llData.access_token || shortLivedToken;
    const expiresIn = llData.expires_in || 5184000;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    const pagesUrl = new URL(metaGraphUrl("me/accounts"));
    pagesUrl.searchParams.set("access_token", longLivedToken);
    pagesUrl.searchParams.set("fields", "id,name,access_token,category,link,tasks,picture.type(large){url},instagram_business_account{id}");

    const pagesResp = await fetch(pagesUrl.toString());
    const pagesData = await pagesResp.json() as any;
    const pages = mapMetaPages(pagesData?.data);

    await mongooseConnect();
    const existingUser = await User.findOne({ email: userEmail }).lean() as any;
    const selectedPage = chooseSetupPage(pages, String(existingUser?.metaPageId || ""));

    // fetch ad accounts
    const adAccountsUrl = new URL(metaGraphUrl("me/adaccounts"));
    adAccountsUrl.searchParams.set("access_token", longLivedToken);
    adAccountsUrl.searchParams.set("fields", "id,name,account_id,account_status,currency");

    const adResp = await fetch(adAccountsUrl.toString());
    const adData = await adResp.json() as any;

    const adAccounts = mapMetaAdAccounts(adData?.data);
    const selectedAdAccount = chooseSetupAdAccount(adAccounts, String(existingUser?.metaAdAccountId || ""));

    await User.updateOne(
      { email: userEmail },
      {
        $set: {
          metaAccessToken: longLivedToken,
          metaTokenExpiresAt: tokenExpiresAt,
          metaReconnectNeeded: false,
          metaHealthStatus: "unknown",
          lastMetaHealthError: "",
          metaHealthCooldownUntil: null,
          ...(selectedAdAccount?.accountId && {
            metaAdAccountId: selectedAdAccount.accountId,
          }),
          ...(selectedPage?.id && {
            metaPageId: selectedPage.id,
            metaPageName: selectedPage.name,
          }),
          ...(selectedPage?.accessToken && {
            metaPageAccessToken: selectedPage.accessToken,
          }),
        },
      }
    );

    // Subscribe page to leadgen webhook field
    if (selectedPage?.id && selectedPage?.accessToken) {
      try {
        const subResp = await fetch(
          metaGraphUrl(`${selectedPage.id}/subscribed_apps`),
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              subscribed_fields: "leadgen",
              access_token: selectedPage.accessToken,
            }).toString(),
          }
        );
        const subJson = await subResp.json();
        if (!subJson?.success) {
          console.warn("[meta/callback] Page subscription to leadgen failed:", JSON.stringify(subJson));
        } else {
          console.info("[meta/callback] Page subscribed to leadgen successfully");
        }
      } catch (subErr: any) {
        console.warn("[meta/callback] Page subscription warning:", subErr?.message);
      }
    }

    return res.redirect(`${BASE_URL}/facebook-leads?meta=connected`);
  } catch (err: any) {
    console.error("[meta/callback] Error:", err?.message);
    return res.redirect(`${BASE_URL}/facebook-leads?meta=error&reason=server_error`);
  }
}
