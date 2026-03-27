// pages/api/admin/platform-senders.ts
// CRUD for PlatformSender records. Admin only.
const nodemailer = require("nodemailer") as any;

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import PlatformSender from "@/models/PlatformSender";
import { encrypt } from "@/lib/prospecting/encrypt";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

async function requireAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email || session.user.email.toLowerCase() !== ADMIN_EMAIL) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdmin(req, res))) return;
  await mongooseConnect();

  // ── GET: list all senders ─────────────────────────────────────────────────
  if (req.method === "GET") {
    const senders = await PlatformSender.find({})
      .select("-smtpPass")
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ senders });
  }

  // ── POST: create a new sender ─────────────────────────────────────────────
  if (req.method === "POST") {
    const { label, fromName, fromEmail, smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure, dailyLimit } =
      req.body || {};

    if (!label || !fromName || !fromEmail || !smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      return res.status(400).json({ error: "All SMTP fields are required" });
    }

    let encryptedPass: string;
    try {
      encryptedPass = encrypt(smtpPass);
    } catch {
      return res.status(500).json({ error: "Encryption not configured" });
    }

    const sender = await PlatformSender.create({
      label,
      fromName,
      fromEmail,
      smtpHost,
      smtpPort: Number(smtpPort),
      smtpUser,
      smtpPass: encryptedPass,
      smtpSecure: smtpSecure === true || smtpSecure === "true",
      dailyLimit: Number(dailyLimit) || 200,
      active: true,
    });

    const { smtpPass: _pass, ...safeData } = (sender as any).toObject();
    return res.status(201).json({ sender: safeData });
  }

  // ── PATCH: toggle active, update dailyLimit ───────────────────────────────
  if (req.method === "PATCH") {
    const { id, active, dailyLimit } = req.body || {};
    if (!id) return res.status(400).json({ error: "id is required" });

    const update: Record<string, any> = {};
    if (typeof active === "boolean") update.active = active;
    if (dailyLimit !== undefined) update.dailyLimit = Number(dailyLimit);

    const updated = await PlatformSender.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    ).select("-smtpPass").lean();

    if (!updated) return res.status(404).json({ error: "Sender not found" });
    return res.status(200).json({ sender: updated });
  }

  // ── DELETE: remove a sender ───────────────────────────────────────────────
  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "id is required" });

    await PlatformSender.findByIdAndDelete(id);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
