// pages/api/voicemail/index.ts
// GET  — list voicemail drops for user
// POST — create a new voicemail drop script
// DELETE /?id=xxx — delete a voicemail drop
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import VoicemailDrop from "@/models/VoicemailDrop";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    const drops = await VoicemailDrop.find({ userEmail }).sort({ isDefault: -1, createdAt: -1 }).lean();
    return res.status(200).json({ drops });
  }

  if (req.method === "POST") {
    const { name, leadType, scriptText, ttsVoice, isDefault } = req.body as {
      name?: string;
      leadType?: string;
      scriptText?: string;
      ttsVoice?: string;
      isDefault?: boolean;
    };

    if (!name || !scriptText) return res.status(400).json({ error: "name and scriptText are required" });

    // If setting as default, unset others
    if (isDefault) {
      await VoicemailDrop.updateMany({ userEmail }, { $set: { isDefault: false } });
    }

    const drop = await VoicemailDrop.create({
      userEmail,
      name,
      leadType: leadType || "General",
      scriptText,
      ttsVoice: ttsVoice || "Polly.Matthew",
      isDefault: isDefault ?? false,
    });

    return res.status(201).json({ ok: true, drop });
  }

  if (req.method === "DELETE") {
    const { id } = req.query as { id?: string };
    if (!id) return res.status(400).json({ error: "id required" });
    await VoicemailDrop.deleteOne({ _id: id, userEmail });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
