// pages/api/objections/index.ts
// GET  — list objections (global + user-specific)
// POST — create a new user objection
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import ObjectionEntry from "@/models/ObjectionEntry";
import { seedGlobalObjections } from "@/lib/leads/seedObjections";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    await seedGlobalObjections();
    const objections = await ObjectionEntry.find({
      $or: [{ isGlobal: true }, { userEmail }],
    })
      .sort({ category: 1, createdAt: -1 })
      .lean();
    return res.status(200).json({ objections });
  }

  if (req.method === "POST") {
    const { objection, response, category } = req.body as {
      objection?: string;
      response?: string;
      category?: string;
    };

    if (!objection || !response) {
      return res.status(400).json({ error: "objection and response are required" });
    }

    const entry = await ObjectionEntry.create({
      userEmail,
      objection,
      response,
      category: category || "other",
      isGlobal: false,
    });

    return res.status(201).json({ ok: true, entry });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
