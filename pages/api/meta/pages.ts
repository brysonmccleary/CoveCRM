// pages/api/meta/pages.ts
// GET — Returns user's connected Facebook pages

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const user = await User.findOne({ email }).lean() as any;
  const token = user?.metaSystemUserToken || user?.metaAccessToken;

  if (!token) {
    return res.status(200).json({ pages: [], connected: false });
  }

  try {
    const url = new URL("https://graph.facebook.com/v19.0/me/accounts");
    url.searchParams.set("access_token", token);
    url.searchParams.set("fields", "id,name,access_token,instagram_business_account{id}");

    const resp = await fetch(url.toString());
    const data = await resp.json() as any;

    if (!resp.ok) {
      return res.status(200).json({ pages: [], connected: false, error: data?.error?.message || "Failed to load pages" });
    }

    return res.status(200).json({
      connected: true,
      selectedPageId: user?.metaPageId || "",
      pages: (data.data || []).map((p: any) => ({
        id: String(p.id || ""),
        name: String(p.name || ""),
        hasToken: !!p.access_token,
        instagramId: String(p?.instagram_business_account?.id || ""),
        selected: String(p.id || "") === String(user?.metaPageId || ""),
      })),
    });
  } catch (err: any) {
    return res.status(200).json({ pages: [], connected: false, error: err?.message });
  }
}
