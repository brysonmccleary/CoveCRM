import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  await dbConnect();

  if (req.method === "GET") {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ message: "Missing key" });

    const user = await User.findOne({ email }).lean();
    const entry = (user?.dialProgress || []).find((p: any) => p.key === key);
    return res.status(200).json({ lastIndex: entry?.lastIndex ?? null, total: entry?.total ?? null, updatedAt: entry?.updatedAt ?? null });
  }

  if (req.method === "POST") {
    const { key, lastIndex, total } = req.body || {};
    if (!key || typeof lastIndex !== "number") {
      return res.status(400).json({ message: "Missing key or lastIndex" });
    }

    const u = await User.findOne({ email });
    if (!u) return res.status(404).json({ message: "User not found" });

    u.dialProgress = u.dialProgress || [];
    const idx = u.dialProgress.findIndex((p: any) => p.key === key);
    const payload = { key, lastIndex, total: typeof total === "number" ? total : undefined, updatedAt: new Date() };
    if (idx >= 0) u.dialProgress[idx] = { ...u.dialProgress[idx], ...payload };
    else u.dialProgress.push(payload);

    await (u as any).save();
    return res.status(200).json({ ok: true });
  }

  // NEW: allow wiping a saved pointer
  if (req.method === "DELETE") {
    const key = (req.body && (req.body as any).key) || String(req.query.key || "");
    if (!key) return res.status(400).json({ message: "Missing key" });

    const u = await User.findOne({ email });
    if (!u) return res.status(404).json({ message: "User not found" });

    u.dialProgress = (u.dialProgress || []).filter((p: any) => p.key !== key);
    await (u as any).save();
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ message: "Method not allowed" });
}
