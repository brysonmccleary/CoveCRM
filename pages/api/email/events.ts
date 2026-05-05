// pages/api/email/events.ts
// Provider email event ingestion (bounces, opens, clicks, replies, unsubscribes).
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import EmailMessage from "@/models/EmailMessage";
import EmailSuppression from "@/models/EmailSuppression";
import { recordEmailBounce } from "@/lib/doi/bounceLearning";
import { recomputeAgentQuality } from "@/lib/doi/recomputeAgentQuality";
import EmailEngagement from "@/models/EmailEngagement";
import mongoose from "mongoose";

type ProviderEvent = {
  type?: string;
  event?: string;
  status?: string;
  messageId?: string;
  message_id?: string;
  resendId?: string;
  resend_id?: string;
  id?: string;
  email?: string;
  to?: string;
  recipient?: string;
  reason?: string;
  bounceType?: string;
  data?: any;
  metadata?: any;
};

const TOKEN = process.env.EMAIL_EVENTS_TOKEN;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (TOKEN) {
    const provided =
      (req.headers["x-email-events-token"] as string | undefined) ||
      (typeof req.query.token === "string" ? req.query.token : undefined);
    if (provided !== TOKEN) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  await mongooseConnect();

  const raw = Array.isArray(req.body?.events)
    ? req.body.events
    : Array.isArray(req.body)
    ? req.body
    : [req.body];

  const events: ProviderEvent[] = raw.filter(Boolean);
  const summary = {
    received: events.length,
    processed: 0,
    doiEvents: 0,
    errors: 0,
  };

  for (const event of events) {
    try {
      const message = await findEmailMessage(event);
      if (!message) {
        summary.errors += 1;
        continue;
      }

      const type = normalizeEventType(event);
      if (!type) continue;

      const recipient = (event.email || event.to || event.recipient || message.to || "").toLowerCase();
      const domain = recipient.includes("@") ? recipient.split("@")[1] : "";
      const isDoi = Boolean(message.doiAgentId || message.doiLeadId);
      if (isDoi) summary.doiEvents += 1;

      if (type === "bounce") {
        await handleBounce(event, message, recipient, domain, isDoi);
      } else if (type === "opened") {
        await handleEngagement(message, recipient, { opened: true }, isDoi);
      } else if (type === "clicked") {
        await handleEngagement(message, recipient, { clicked: true }, isDoi);
      } else if (type === "replied") {
        await handleEngagement(message, recipient, { replied: true }, isDoi);
      } else if (type === "unsubscribed") {
        await handleUnsubscribe(message, recipient, isDoi);
        await handleEngagement(message, recipient, { unsubscribed: true }, isDoi);
      }

      summary.processed += 1;
    } catch (err) {
      console.error("[email/events] Failed to process", err);
      summary.errors += 1;
    }
  }

  return res.status(200).json({ ok: true, summary });
}

function normalizeEventType(event: ProviderEvent): "bounce" | "opened" | "clicked" | "replied" | "unsubscribed" | null {
  const type = (event.type || event.event || event.status || "").toLowerCase();
  if (!type) return null;
  if (type.includes("bounce")) return "bounce";
  if (type.includes("open")) return "opened";
  if (type.includes("click")) return "clicked";
  if (type.includes("reply")) return "replied";
  if (type.includes("unsubscribe")) return "unsubscribed";
  return null;
}

async function findEmailMessage(event: ProviderEvent) {
  const ids = [
    event.messageId,
    event.message_id,
    event.resendId,
    event.resend_id,
    event.id,
    event.data?.id,
    event.data?.email_id,
  ].filter(Boolean) as string[];

  for (const id of ids) {
    const byResend = await EmailMessage.findOne({ resendId: id }).lean();
    if (byResend) return byResend;
    if (mongoose.Types.ObjectId.isValid(id)) {
      const byId = await EmailMessage.findById(id).lean();
      if (byId) return byId;
    }
  }

  const recipient = (event.email || event.to || event.recipient || "").toLowerCase();
  if (recipient) {
    return EmailMessage.findOne({ to: recipient }).sort({ createdAt: -1 }).lean();
  }
  return null;
}

async function handleBounce(
  event: ProviderEvent,
  message: any,
  recipient: string,
  domain: string,
  isDoi: boolean
) {
  await EmailMessage.updateOne(
    { _id: message._id },
    { $set: { status: "bounced" } }
  );

  await recordEmailBounce({
    email: recipient,
    agentId: message.doiAgentId ? String(message.doiAgentId) : undefined,
    domain,
    bounceType: (event.bounceType || event.status || "").includes("soft") ? "soft" : "hard",
    reason: event.reason || "",
    source: "domain_pattern",
  });

  await EmailSuppression.updateOne(
    { userEmail: message.userEmail, email: recipient },
    {
      $setOnInsert: {
        userId: message.userId,
        suppressedAt: new Date(),
      },
      $set: { reason: "bounced" },
    },
    { upsert: true }
  );

  if (isDoi && message.doiAgentId) {
    try {
      await recomputeAgentQuality(String(message.doiAgentId));
    } catch (err) {
      console.error("[email/events] recompute after bounce failed", err);
    }
  }
}

async function handleEngagement(
  message: any,
  recipient: string,
  flags: Partial<{ opened: boolean; clicked: boolean; replied: boolean; unsubscribed: boolean }>,
  isDoi: boolean
) {
  const nextStatus = determineNextStatus(message.status, flags);
  const update: Record<string, any> = {};
  if (nextStatus && nextStatus !== message.status) {
    update.status = nextStatus;
  }
  if (flags.opened) {
    update.openedAt = new Date();
  }
  if (flags.replied) {
    update.repliedAt = new Date();
  }
  if (Object.keys(update).length) {
    await EmailMessage.updateOne({ _id: message._id }, { $set: update });
  }

  if (isDoi && message.doiAgentId) {
    const engagementUpdates: Record<string, any> = {
      lastEngagementAt: new Date(),
    };
    if (flags.opened) engagementUpdates.opened = true;
    if (flags.clicked) engagementUpdates.clicked = true;
    if (flags.replied) engagementUpdates.replied = true;
    if (flags.unsubscribed) engagementUpdates.unsubscribed = true;

    await EmailEngagement.updateOne(
      { agentId: message.doiAgentId, email: recipient },
      {
        $setOnInsert: {
          campaignId: message.campaignId || null,
        },
        $set: engagementUpdates,
      },
      { upsert: true }
    );

    try {
      await recomputeAgentQuality(String(message.doiAgentId));
    } catch (err) {
      console.error("[email/events] recompute after engagement failed", err);
    }
  }
}

async function handleUnsubscribe(message: any, recipient: string, isDoi: boolean) {
  await EmailSuppression.updateOne(
    { userEmail: message.userEmail, email: recipient },
    {
      $setOnInsert: {
        userId: message.userId,
        suppressedAt: new Date(),
      },
      $set: { reason: "unsubscribed" },
    },
    { upsert: true }
  );

  if (isDoi && message.doiAgentId) {
    try {
      await recomputeAgentQuality(String(message.doiAgentId));
    } catch (err) {
      console.error("[email/events] recompute after unsubscribe failed", err);
    }
  }
}

function determineNextStatus(
  current: string,
  flags: Partial<{ opened: boolean; clicked: boolean; replied: boolean; unsubscribed: boolean }>
) {
  if (flags.replied) return "replied";
  if (flags.opened && current !== "replied" && current !== "bounced") return "opened";
  return null;
}
