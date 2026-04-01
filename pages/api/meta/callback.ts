// pages/api/meta/callback.ts
// GET — Handle OAuth callback from Meta, exchange code for long-lived token

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

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

  const { code, error: oauthError } = req.query as { code?: string; error?: string };

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
  const redirectUri = `${BASE_URL}/api/meta/callback`;

  try {
    const tokenUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
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

    const llUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
    llUrl.searchParams.set("grant_type", "fb_exchange_token");
    llUrl.searchParams.set("client_id", META_APP_ID);
    llUrl.searchParams.set("client_secret", META_APP_SECRET);
    llUrl.searchParams.set("fb_exchange_token", shortLivedToken);

    const llResp = await fetch(llUrl.toString());
    const llData = await llResp.json() as any;

    const longLivedToken = llData.access_token || shortLivedToken;
    const expiresIn = llData.expires_in || 5184000;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    const pagesUrl = new URL("https://graph.facebook.com/v19.0/me/accounts");
    pagesUrl.searchParams.set("access_token", longLivedToken);
    pagesUrl.searchParams.set("fields", "id,name,access_token,instagram_business_account{id}");

    const pagesResp = await fetch(pagesUrl.toString());
    const pagesData = await pagesResp.json() as any;
    const pages = pagesData?.data || [];
    const firstPage = pages[0];

    await mongooseConnect();

    await User.updateOne(
      { email: userEmail },
      {
        $set: {
          metaAccessToken: longLivedToken,
          metaTokenExpiresAt: tokenExpiresAt,
          ...(firstPage ? {
            metaPageId: String(firstPage.id || ""),
            metaPageName: String(firstPage.name || ""),
            metaInstagramId: String(firstPage?.instagram_business_account?.id || ""),
          } : {}),
        },
      }
    );

    return res.redirect(`${BASE_URL}/facebook-leads?meta=connected`);
  } catch (err: any) {
    console.error("[meta/callback] Error:", err?.message);
    return res.redirect(`${BASE_URL}/facebook-leads?meta=error&reason=server_error`);
  }
}
