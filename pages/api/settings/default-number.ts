// pages/api/settings/default-number.ts
// GET  — get current default SMS number
// POST — set default SMS number
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    const user = await User.findOne({ email: userEmail })
      .select("defaultSmsNumberId numbers")
      .lean();
    return res.status(200).json({
      defaultSmsNumberId: (user as any)?.defaultSmsNumberId ?? null,
      numbers: (user as any)?.numbers ?? [],
    });
  }

  if (req.method === "POST") {
    const { numberId } = req.body as { numberId?: string };
    await User.updateOne(
      { email: userEmail },
      { $set: { defaultSmsNumberId: numberId ?? null } }
    );
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
