// pages/api/meta/disconnect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  await User.updateOne(
    { email: session.user.email },
    {
      $set: {
        metaAccessToken: "",
        metaTokenExpiresAt: null,
        metaReconnectNeeded: false,
        metaHealthStatus: "unknown",
        lastMetaHealthError: "",
        metaHealthCooldownUntil: null,
        metaPageId: "",
        metaPageName: "",
        metaPageAccessToken: "",
        metaAdAccountId: "",
        metaInstagramId: "",
      },
    }
  );

  return res.status(200).json({ ok: true });
}
