// lib/reviews/sendReviewRequest.ts
// Review-request automation: when a lead's disposition is set to "Sold,"
// send a one-time review-request text with the agent's Google/Yelp link.
// Gated by a per-user AISettings toggle (off by default — an agent must
// explicitly enable it and set a URL). Reuses the canonical SMS send path
// and opt-out compliance footer; no new compliance copy.
import AISettings from "@/models/AISettings";
import Lead from "@/models/Lead";
import { sendSMS } from "@/lib/twilio/sendSMS";
import { withStopFooter } from "@/lib/sms/complianceFooter";

const REVIEW_REQUEST_BODY_PREFIX = "Thanks for choosing us! If you have a minute, we'd really appreciate a quick review:";

export async function sendReviewRequestOnce(opts: { leadId: string; userEmail: string }) {
  const userEmail = String(opts.userEmail || "").toLowerCase();
  const leadId = String(opts.leadId || "");
  if (!userEmail || !leadId) return;

  const settings = await (AISettings as any).findOne({ userEmail }).lean();
  const reviewUrl = String(settings?.reviewRequestUrl || "").trim();
  if (!settings?.reviewRequestEnabled || !reviewUrl) return;

  const claimAt = new Date();
  const staleClaimBefore = new Date(claimAt.getTime() - 5 * 60 * 1000);

  // Claim the send without marking it complete. A failed Twilio request
  // releases the claim so a later Sold event can retry it. Stale claims are
  // recoverable after five minutes if a process exits mid-send.
  const lead = await (Lead as any)
    .findOneAndUpdate(
      {
        _id: leadId,
        userEmail,
        $and: [
          { $or: [{ reviewRequestSentAt: null }, { reviewRequestSentAt: { $exists: false } }] },
          { $or: [{ reviewRequestSendingAt: null }, { reviewRequestSendingAt: { $exists: false } }, { reviewRequestSendingAt: { $lt: staleClaimBefore } }] },
        ],
      },
      { $set: { reviewRequestSendingAt: claimAt } },
      { new: false },
    )
    .lean();
  if (!lead) return;

  const phone = String((lead as any)?.Phone || (lead as any)?.phone || "").trim();
  if (!phone) {
    await (Lead as any).updateOne(
      { _id: leadId, userEmail, reviewRequestSendingAt: claimAt },
      { $unset: { reviewRequestSendingAt: "" } },
    );
    return;
  }

  try {
    await sendSMS(phone, withStopFooter(`${REVIEW_REQUEST_BODY_PREFIX} ${reviewUrl}`), userEmail, {
      source: "review_request",
      leadId,
    });
    await (Lead as any).updateOne(
      { _id: leadId, userEmail, reviewRequestSendingAt: claimAt },
      { $set: { reviewRequestSentAt: new Date() }, $unset: { reviewRequestSendingAt: "" } },
    );
  } catch (error) {
    await (Lead as any).updateOne(
      { _id: leadId, userEmail, reviewRequestSendingAt: claimAt },
      { $unset: { reviewRequestSendingAt: "" } },
    ).catch(() => undefined);
    throw error;
  }
}
