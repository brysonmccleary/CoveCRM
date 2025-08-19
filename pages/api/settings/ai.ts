// /pages/api/settings/ai.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]"; // correct relative path for /pages/api/settings/*
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";

type GetResp =
  | { ok: true; aiAssistantName: string; hasAI?: boolean; plan?: string }
  | { ok: false; error: string };

type PostBody = { aiAssistantName?: string };
type PostResp =
  | { ok: true; aiAssistantName: string }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GetResp | PostResp>,
) {
  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email;
  if (!email) return res.status(401).json({ ok: false, error: "Unauthorized" });

  await dbConnect();

  if (req.method === "GET") {
    const user = await User.findOne({ email }).lean();
    if (!user)
      return res.status(404).json({ ok: false, error: "User not found" });
    return res.status(200).json({
      ok: true,
      aiAssistantName: user.aiAssistantName || "Assistant",
      hasAI: user.hasAI ?? false,
      plan: user.plan ?? "Free",
    });
  }

  if (req.method === "POST") {
    const { aiAssistantName } = (req.body || {}) as PostBody;
    const name = String(aiAssistantName || "").trim();
    if (!name)
      return res.status(400).json({ ok: false, error: "Name is required" });
    if (name.length > 40) {
      return res
        .status(400)
        .json({ ok: false, error: "Name must be 40 characters or fewer" });
    }

    const user = await User.findOneAndUpdate(
      { email },
      { $set: { aiAssistantName: name } },
      { new: true },
    ).lean();
    if (!user)
      return res.status(404).json({ ok: false, error: "User not found" });

    return res
      .status(200)
      .json({ ok: true, aiAssistantName: user.aiAssistantName || "Assistant" });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
