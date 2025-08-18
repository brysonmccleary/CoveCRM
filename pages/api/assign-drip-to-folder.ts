// /pages/api/assign-drip-to-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import DripCampaign from "@/models/DripCampaign";
import User from "@/models/User";
import { sendSMS } from "@/lib/twilio/sendSMS";
import { ObjectId } from "mongodb";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import {
  renderTemplate,
  ensureOptOut,
  splitName,
} from "@/utils/renderTemplate";

// ----- helpers -----
function isValidObjectId(id: string) {
  return /^[a-f0-9]{24}$/i.test(id);
}

// Resolve a drip by either Mongo _id or by prebuilt slug -> name
async function resolveDrip(dripId: string) {
  if (isValidObjectId(dripId)) {
    return await DripCampaign.findById(dripId).lean();
  }
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
  if (phone.startsWith("+")) return phone;
  return null;
}

async function runBatched<T>(
  items: T[],
  batchSize: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let i = 0;
  while (i < items.length) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map((item, idx) => worker(item, i + idx)));
    i += batchSize;
  }
}

// ----- handler -----
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  const { dripId, folderId } = req.body as {
    dripId?: string;
    folderId?: string;
  };
  if (!dripId || !folderId)
    return res.status(400).json({ message: "Missing dripId or folderId" });

  try {
    await dbConnect();
    const userEmail = String(session.user.email).toLowerCase();

    const user = await User.findOne({ email: userEmail })
      .select({ _id: 1, email: 1, name: 1 })
      .lean();
    if (!user?._id) return res.status(404).json({ message: "User not found" });

    // 1) Validate folder belongs to this user
    const folder = await Folder.findOne({
      _id: new ObjectId(folderId),
      userEmail,
    });
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // 2) Save assignment on folder (idempotent)
    const set = new Set(folder.assignedDrips || []);
    set.add(dripId);
    if (set.size !== (folder.assignedDrips || []).length) {
      folder.assignedDrips = Array.from(set);
      await folder.save();
    }

    // 3) Enroll existing leads (idempotent)
    await Lead.updateMany(
      { userEmail, folderId: new ObjectId(folderId) },
      { $addToSet: { assignedDrips: dripId } },
    );

    // 4) Send first step immediately (only for SMS drips)
    const drip = await resolveDrip(dripId);
    if (
      !drip ||
      drip.type !== "sms" ||
      !Array.isArray(drip.steps) ||
      drip.steps.length === 0
    ) {
      return res.status(200).json({
        message: "Drip assigned. No immediate SMS sent (non-SMS or no steps).",
        modifiedLeads: 0,
        sent: 0,
        failed: 0,
      });
    }

    const stepsSorted = [...drip.steps].sort(
      (a: any, b: any) =>
        (parseInt(a?.day ?? "0", 10) || 0) - (parseInt(b?.day ?? "0", 10) || 0),
    );
    const firstTextRaw: string = stepsSorted[0]?.text?.trim?.() || "";
    if (!firstTextRaw) {
      return res.status(200).json({
        message: "Drip assigned. First step empty, nothing sent.",
        modifiedLeads: 0,
        sent: 0,
        failed: 0,
      });
    }

    // 🚫 Safety: don't send explicit opt-out keywords as an outbound drip
    const lower = firstTextRaw.toLowerCase();
    const optOutKeywords = ["stop", "unsubscribe", "end", "quit", "cancel"];
    if (optOutKeywords.includes(lower)) {
      return res
        .status(400)
        .json({ message: "First step is an opt-out keyword. Not sending." });
    }

    // Prepare agent context once
    const { first: agentFirst, last: agentLast } = splitName(user.name || "");
    const agentCtx = {
      name: user.name || null,
      first_name: agentFirst,
      last_name: agentLast,
    };

    // Canonical drip id for progress tracking
    const canonicalDripId = String((drip as any)?._id || dripId);
    const now = new Date();

    const leads = await Lead.find({
      userEmail,
      folderId: new ObjectId(folderId),
    })
      .select({
        _id: 1,
        Phone: 1,
        "First Name": 1,
        "Last Name": 1,
        unsubscribed: 1,
      })
      .lean();

    let sent = 0;
    let failed = 0;

    await runBatched(leads, 25, async (lead) => {
      const to = normalizeToE164Maybe((lead as any).Phone);
      if (!to || (lead as any).unsubscribed) {
        failed++;
        return;
      }
      try {
        // Build contact context
        const firstName = (lead as any)["First Name"] || null;
        const lastName = (lead as any)["Last Name"] || null;
        const fullName =
          [firstName, lastName]
            .filter((x) => x && String(x).trim().length > 0)
            .join(" ") || null;

        const rendered = renderTemplate(firstTextRaw, {
          contact: {
            first_name: firstName,
            last_name: lastName,
            full_name: fullName,
          },
          agent: agentCtx,
        });

        // Ensure compliant opt-out tag even if missing in a custom/user drip
        const finalBody = ensureOptOut(rendered);

        // ✅ Send via Twilio helper (persists to Message, status-callback, usage, etc.)
        await sendSMS(to, finalBody, String(user._id));

        // ✅ Initialize/Update dripProgress for this lead (Day 1 has been sent -> index 0)
        const matched = await Lead.updateOne(
          { _id: (lead as any)._id, "dripProgress.dripId": canonicalDripId },
          {
            $set: {
              "dripProgress.$.startedAt": now,
              "dripProgress.$.lastSentIndex": 0,
            },
          },
        );

        if (matched.matchedCount === 0) {
          await Lead.updateOne(
            { _id: (lead as any)._id },
            {
              $push: {
                dripProgress: {
                  dripId: canonicalDripId,
                  startedAt: now,
                  lastSentIndex: 0,
                },
              },
            },
          );
        }

        sent++;
      } catch (e) {
        failed++;
        console.error("Immediate drip send failed:", e);
      }
    });

    return res.status(200).json({
      message:
        "Drip assigned, leads enrolled, and first step sent (rendered with names + opt-out). Progress initialized.",
      modifiedLeads: leads.length,
      sent,
      failed,
    });
  } catch (error) {
    console.error("Error assigning drip:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
