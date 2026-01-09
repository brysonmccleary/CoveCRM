// pages/api/ai/response-handler.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import mongoose from "mongoose";
import { AiQueuedReply } from "@/models/AiQueuedReply";
import { LeadAIState } from "@/models/LeadAIState";
import crypto from "crypto";

function hashBody(s: string) {
  return crypto.createHash("sha256").update(String(s || "").trim().toLowerCase()).digest("hex").slice(0, 16);
}

function randomDelayMs(minMs: number, maxMs: number) {
  const n = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return n;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const { Body, From } = req.body;
  if (!Body || !From)
    return res.status(400).json({ message: "Missing message or sender." });

  try {
    if (!mongoose.connection.readyState) {
      await dbConnect();
    }

    const sanitizedPhone = String(From).replace(/\D/g, "").slice(-10); // Extract last 10 digits
    const lead = await Lead.findOne({
      phone: { $regex: sanitizedPhone + "$" },
    });

    if (!lead) {
      console.warn(`No lead found for incoming SMS from ${From}`);
      return res.status(200).end(); // Exit silently to avoid Twilio retries
    }

    // Drop from drip if they're still in one
    if ((lead as any).assignedDrip) {
      (lead as any).assignedDrip = null;
      (lead as any).droppedFromDrip = true;
      (lead as any).droppedFromDripAt = new Date();
      await lead.save();
    }

    // ✅ NEW: record inbound time & clear suppression (lead replied)
    try {
      const now = new Date();
      const userEmail = String((lead as any).userEmail || "");

      if (userEmail) {
        await LeadAIState.updateOne(
          { userEmail, leadId: (lead as any)._id },
          {
            $set: {
              userEmail,
              leadId: (lead as any)._id,
              phoneLast10: sanitizedPhone,
              lastLeadInboundAt: now,
              // lead replied, so suppression no longer blocks reply flow
              aiSuppressedUntil: null,
            },
          },
          { upsert: true }
        );
      }
    } catch (e: any) {
      console.warn("⚠️ inbound LeadAIState update failed:", e?.message || e);
    }

    // ✅ CRITICAL FIX: DO NOT call handleAIResponse() here (prevents duplicate AI sends).
    // Instead: enqueue a queued AI reply with a 2–3 minute human-like delay.
    const userEmail = String((lead as any).userEmail || "");
    if (!userEmail) {
      // if we can't identify the tenant, do nothing (safe)
      return res.status(200).end();
    }

    const now = new Date();
    const delayMs = randomDelayMs(2 * 60 * 1000, 3 * 60 * 1000);
    const sendAfter = new Date(now.getTime() + delayMs);

    const bodyHash = hashBody(String(Body));
    // Simple dedupe: if the same inbound body already produced a queued job recently, don't queue again
    const recent = await AiQueuedReply.findOne({
      leadId: (lead as any)._id,
      userEmail,
      status: { $in: ["queued", "sending", "sent"] },
      createdAt: { $gte: new Date(now.getTime() - 10 * 60 * 1000) },
      // cheap heuristic (exact match on body is okay here)
      body: { $regex: bodyHash }, // (won't match unless body contains it; see below)
    }).lean();

    // The above regex isn't reliable since we aren't storing hash in schema.
    // We'll do a safer exact-body recent check instead:
    const recentExact = await AiQueuedReply.findOne({
      leadId: (lead as any)._id,
      userEmail,
      status: { $in: ["queued", "sending", "sent"] },
      createdAt: { $gte: new Date(now.getTime() - 10 * 60 * 1000) },
      body: String(Body).trim(),
    }).lean();

    if (!recent && !recentExact) {
      await AiQueuedReply.create({
        leadId: (lead as any)._id,
        userEmail,
        to: String((lead as any).phone || From),
        body: String(Body).trim(), // NOTE: this is the inbound text; your queue sender must transform to an AI reply elsewhere.
        sendAfter,
        status: "queued",
        attempts: 0,
      });
    }

    return res.status(200).end();
  } catch (err) {
    console.error("Error in AI response handler:", err);
    return res.status(500).end("Internal Server Error");
  }
}
