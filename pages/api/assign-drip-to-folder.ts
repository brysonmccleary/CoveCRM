// pages/api/assign-drip-to-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import DripCampaign from "@/models/DripCampaign";
import DripEnrollment from "@/models/DripEnrollment";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import User from "@/models/User";
import { sendSMS } from "@/lib/twilio/sendSMS";
import { acquireLock } from "@/lib/locks";
import { ObjectId } from "mongodb";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";
import { DateTime } from "luxon";

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;

function nextWindowPT(): Date {
  const nowPT = DateTime.now().setZone(PT_ZONE);
  const base = nowPT.hour < SEND_HOUR_PT ? nowPT : nowPT.plus({ days: 1 });
  return base.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}

function isValidObjectId(id: string) { return /^[a-f0-9]{24}$/i.test(id); }

async function resolveDrip(dripId: string) {
  if (isValidObjectId(dripId)) return await DripCampaign.findById(dripId).lean();
  const def = prebuiltDrips.find((d) => d.id === dripId);
  if (!def) return null;
  return await DripCampaign.findOne({ isGlobal: true, name: def.name }).lean();
}

function normalizeToE164Maybe(phone?: string): string | null {
  if (!phone) return null;
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if ((phone || "").startsWith("+")) return phone!;
  return null;
}

async function runBatched<T>(items: T[], batchSize: number, worker: (item: T, index: number) => Promise<void>) {
  let i = 0;
  while (i < items.length) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map((item, idx) => worker(item, i + idx)));
    i += batchSize;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { dripId, folderId, startMode } = (req.body || {}) as {
    dripId?: string;
    folderId?: string;
    /** "immediate" (default) or "nextWindow" */
    startMode?: "immediate" | "nextWindow";
  };
  if (!dripId || !folderId) return res.status(400).json({ message: "Missing dripId or folderId" });

  try {
    await dbConnect();
    const userEmail = String(session.user.email).toLowerCase();

    const user = await User.findOne({ email: userEmail }).select({ _id: 1, email: 1, name: 1 }).lean();
    if (!user?._id) return res.status(404).json({ message: "User not found" });

    const folder = await Folder.findOne({ _id: new ObjectId(folderId), userEmail });
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // 1) Add drip assignment to folder (idempotent)
    const set = new Set<string>(Array.isArray(folder.assignedDrips) ? folder.assignedDrips : []);
    set.add(dripId);
    if (set.size !== (folder.assignedDrips || []).length) {
      folder.assignedDrips = Array.from(set);
      await folder.save();
    }

    // 2) Resolve drip + basic validation
    const raw = await resolveDrip(dripId);
    const drip: any = raw;
    if (!drip || drip.type !== "sms" || !Array.isArray(drip.steps) || drip.steps.length === 0) {
      return res.status(200).json({ message: "Drip assigned (non-SMS or empty). No enrollment created.", createdEnrollments: 0, sent: 0, failed: 0 });
    }

    const stepsSorted = [...drip.steps].sort(
      (a: any, b: any) => (parseInt(a?.day ?? "0", 10) || 0) - (parseInt(b?.day ?? "0", 10) || 0),
    );
    const firstTextRaw: string = stepsSorted[0]?.text?.trim?.() || "";

    // 3) Upsert a folder watcher so NEW leads are auto-enrolled by cron
    await DripFolderEnrollment.findOneAndUpdate(
      { userEmail, folderId: new ObjectId(folderId), campaignId: new ObjectId(String(drip._id)), active: true },
      { $setOnInsert: { userEmail, folderId: new ObjectId(folderId), campaignId: new ObjectId(String(drip._id)), active: true, startMode: startMode || "immediate" } },
      { upsert: true, new: true }
    );

    // 4) Enroll ALL existing leads in this folder (idempotent)
    const leads = await Lead.find({ userEmail, folderId: new ObjectId(folderId) })
      .select({ _id: 1, Phone: 1, "First Name": 1, "Last Name": 1, unsubscribed: 1 })
      .lean();

    const canonicalDripId = new ObjectId(String(drip._id));
    const nextSendAt = (startMode === "nextWindow") ? nextWindowPT() : new Date();

    let createdEnrollments = 0, sent = 0, failed = 0;

    await runBatched(leads, 25, async (lead) => {
      // Upsert enrollment (only if not already active/paused)
      const before = await DripEnrollment.findOne({
        userEmail, leadId: lead._id, campaignId: canonicalDripId, status: { $in: ["active", "paused"] },
      }).select({ _id: 1 }).lean();

      if (!before?._id) {
        await DripEnrollment.create({
          userEmail, leadId: lead._id, campaignId: canonicalDripId,
          status: "active", cursorStep: 0, nextSendAt, source: "folder-bulk",
        });
        createdEnrollments++;
      }

      // Optional immediate first send (only if startMode !== "nextWindow" and first step non-empty)
      if ((startMode || "immediate") === "immediate" && firstTextRaw) {
        const to = normalizeToE164Maybe((lead as any).Phone);
        if (!to || (lead as any).unsubscribed) return;

        const { first: agentFirst, last: agentLast } = splitName(user.name || "");
        const agentCtx = { name: user.name || null, first_name: agentFirst, last_name: agentLast };

        const firstName = (lead as any)["First Name"] || null;
        const lastName  = (lead as any)["Last Name"]  || null;
        const fullName  = [firstName, lastName].filter(Boolean).join(" ") || null;

        const rendered  = renderTemplate(firstTextRaw, { contact: { first_name: firstName, last_name: lastName, full_name: fullName }, agent: agentCtx });
        const finalBody = ensureOptOut(rendered);

        const stepKey = String(stepsSorted[0]?.day ?? 1);
        const ok = await acquireLock("drip", `${userEmail}:${String(lead._id)}:${String(canonicalDripId)}:${stepKey}`, 600);
        if (!ok) return;

        try {
          await sendSMS(to, finalBody, String(user._id));
          // Initialize progress to index 0 (first step sent)
          await Lead.updateOne(
            { _id: lead._id, "dripProgress.dripId": String(canonicalDripId) },
            { $set: { "dripProgress.$.startedAt": new Date(), "dripProgress.$.lastSentIndex": 0 } }
          );
          await Lead.updateOne(
            { _id: lead._id, "dripProgress.dripId": { $ne: String(canonicalDripId) } },
            { $push: { dripProgress: { dripId: String(canonicalDripId), startedAt: new Date(), lastSentIndex: 0 } } }
          );
          sent++;
        } catch (e) {
          failed++;
          console.error("Immediate drip send failed:", e);
        }
      }
    });

    return res.status(200).json({
      message: "Drip assigned. Watcher upserted. Enrollments created. First step handled.",
      createdEnrollments,
      leadsConsidered: leads.length,
      sent,
      failed,
      startMode: startMode || "immediate",
    });
  } catch (error) {
    console.error("Error assigning drip:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
