// /pages/api/cron/send-ai-queued.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { AiQueuedReply } from "@/models/AiQueuedReply";
import Lead from "@/models/Lead";
import User from "@/models/User";
import { sendSms } from "@/lib/twilio/sendSMS";
import { initSocket } from "@/lib/socket";

const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Vercel Cron uses GET by default; keep this strict
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Primary cron secret for scheduled jobs
  const CRON_SECRET = process.env.CRON_SECRET || "";

  // Accept token from query (?token=...) or Authorization: Bearer ...
  const queryToken =
    typeof req.query.token === "string" ? (req.query.token as string) : undefined;

  const authHeader =
    typeof req.headers.authorization === "string"
      ? (req.headers.authorization as string)
      : "";

  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");

  // Vercel Scheduled Functions include this header
  const isVercelCron = !!req.headers["x-vercel-cron"];

  const provided = queryToken || bearerToken || "";

  // ✅ Allow either:
  //  - Vercel cron (x-vercel-cron present), OR
  //  - CRON_SECRET / INTERNAL_API_TOKEN via query or Bearer
  if (
    !isVercelCron &&
    (!provided || (provided !== CRON_SECRET && provided !== INTERNAL_API_TOKEN))
  ) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    await mongooseConnect();

    const now = new Date();
    const limit = Number(req.query.limit || 25);

    const io = (res as any)?.socket?.server?.io || initSocket(res as any);

    const queueItems = await AiQueuedReply.find({
      status: "queued",
      sendAfter: { $lte: now },
    })
      .sort({ sendAfter: 1, createdAt: 1 })
      .limit(limit)
      .lean();

    if (!queueItems.length) {
      return res.status(200).json({ processed: 0 });
    }

    let processed = 0;

    for (const item of queueItems) {
      // Double-lock to avoid races
      const locked = await AiQueuedReply.findOneAndUpdate(
        { _id: item._id, status: "queued" },
        { $set: { status: "sending" }, $inc: { attempts: 1 } },
        { new: true }
      );
      if (!locked) continue;

      try {
        const userEmail = locked.userEmail;
        const user = await User.findOne({ email: userEmail });
        const lead = await Lead.findById(locked.leadId);
        if (!user || !lead) {
          await AiQueuedReply.updateOne(
            { _id: locked._id },
            { $set: { status: "failed", failReason: "Missing user or lead" } }
          );
          continue;
        }

        const sendResult = await sendSms({
          to: locked.to,
          body: locked.body,
          userEmail: userEmail,
          leadId: String(lead._id),
        });

        const aiEntry = {
          type: "ai" as const,
          text: locked.body,
          date: new Date(),
        };
        lead.interactionHistory = lead.interactionHistory || [];
        lead.interactionHistory.push(aiEntry);
        (lead as any).aiLastResponseAt = new Date();
        await lead.save();

        if (io) {
          io.to(userEmail).emit("message:new", { leadId: lead._id, ...aiEntry });
          io.to(userEmail).emit("message:sent", {
            _id: sendResult.messageId,
            sid: (sendResult as any).sid,
            status: sendResult.scheduledAt ? "scheduled" : "accepted",
          });
        }

        await AiQueuedReply.updateOne(
          { _id: locked._id },
          { $set: { status: "sent" } }
        );

        processed += 1;
      } catch (err: any) {
        console.error("❌ Failed to send queued AI reply:", err);
        await AiQueuedReply.updateOne(
          { _id: locked._id },
          {
            $set: {
              status: "failed",
              failReason: err?.message || "Unknown error",
            },
          }
        );
      }
    }

    return res.status(200).json({ processed });
  } catch (err: any) {
    console.error("❌ send-ai-queued cron error:", err);
    return res.status(500).json({ message: "Cron error" });
  }
}
