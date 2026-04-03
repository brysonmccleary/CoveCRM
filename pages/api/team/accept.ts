// pages/api/team/accept.ts
// POST — accept a team invite via token
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import TeamInvite from "@/models/TeamInvite";
import TeamMember from "@/models/TeamMember";
import crypto from "crypto";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await mongooseConnect();

  const { token, ownerEmail, acceptorEmail, acceptorName } = req.body as {
    token?: string;
    ownerEmail?: string;
    acceptorEmail?: string;
    acceptorName?: string;
  };

  if (!token || !ownerEmail || !acceptorEmail) {
    return res.status(400).json({ error: "token, ownerEmail, and acceptorEmail are required" });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const invite = await TeamInvite.findOne({
    tokenHash,
    ownerEmail: ownerEmail.toLowerCase(),
    status: "pending",
  });

  if (!invite) return res.status(404).json({ error: "Invalid or expired invite" });
  if (new Date(invite.expiresAt) < new Date()) {
    await TeamInvite.updateOne({ _id: invite._id }, { $set: { status: "expired" } });
    return res.status(410).json({ error: "Invite has expired" });
  }

  if (String(invite.inviteeEmail || "").toLowerCase() !== acceptorEmail.toLowerCase()) {
    return res.status(403).json({ error: "This invite was sent to a different email address." });
  }

  // Create team member
  await TeamMember.findOneAndUpdate(
    { ownerEmail: ownerEmail.toLowerCase(), memberEmail: acceptorEmail.toLowerCase() },
    {
      $set: {
        memberEmail: acceptorEmail.toLowerCase(),
        ownerEmail: ownerEmail.toLowerCase(),
        memberName: acceptorName || acceptorEmail,
        status: "active",
        joinedAt: new Date(),
      },
    },
    { upsert: true }
  );

  await TeamInvite.updateOne({ _id: invite._id }, { $set: { status: "accepted" } });

  return res.status(200).json({ ok: true });
}
