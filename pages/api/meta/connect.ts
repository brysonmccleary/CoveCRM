// pages/api/meta/connect.ts
// GET — initiate Meta OAuth flow

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";

const META_APP_ID = process.env.META_APP_ID || "";
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  if (!META_APP_ID) {
    return res.status(500).json({ error: "META_APP_ID not configured" });
  }

  const redirectUri = `${BASE_URL}/api/meta/callback`;
  const scope = [
    "ads_management",
    "ads_read",
    "business_management",
    "pages_read_engagement",
    "pages_show_list",
  ].join(",");

  const userId = String((session.user as any).id || session.user.email);

  const oauthUrl = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  oauthUrl.searchParams.set("client_id", META_APP_ID);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("scope", scope);
  oauthUrl.searchParams.set("state", encodeURIComponent(userId));
  oauthUrl.searchParams.set("response_type", "code");

  return res.redirect(oauthUrl.toString());
}
