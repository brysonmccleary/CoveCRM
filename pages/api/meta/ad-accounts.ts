// pages/api/meta/ad-accounts.ts
// GET — Returns user's Meta ad accounts

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
    return res.status(200).json({ adAccounts: [], connected: false });
  }

  try {
    const url = new URL("https://graph.facebook.com/v19.0/me/adaccounts");
    url.searchParams.set("access_token", token);
    url.searchParams.set("fields", "id,name,account_id,account_status,currency");

    const resp = await fetch(url.toString());
    const data = await resp.json() as any;

    if (!resp.ok) {
      return res.status(200).json({ adAccounts: [], connected: false, error: data?.error?.message || "Failed to load ad accounts" });
    }

    return res.status(200).json({
      connected: true,
      selectedAdAccountId: user?.metaAdAccountId || "",
      adAccounts: (data.data || []).map((a: any) => ({
        id: String(a.id || ""),
        name: String(a.name || ""),
        account_id: String(a.account_id || String(a.id || "").replace(/^act_/, "")),
        status: a.account_status,
        currency: a.currency,
        selected:
          String(a.account_id || String(a.id || "").replace(/^act_/, "")) === String(user?.metaAdAccountId || "") ||
          String(a.id || "").replace(/^act_/, "") === String(user?.metaAdAccountId || ""),
      })),
    });
  } catch (err: any) {
    return res.status(200).json({ adAccounts: [], connected: false, error: err?.message });
  }
}
