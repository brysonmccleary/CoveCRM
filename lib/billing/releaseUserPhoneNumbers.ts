import { stripe } from "@/lib/stripe";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { isPhoneNumberSubscription } from "@/lib/billing/stripePlanClassification";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";

const log = (msg: string, extra?: Record<string, unknown>) => {
  try {
    console.info(`[release-user-numbers] ${msg}`, extra || {});
  } catch {}
};

const isTwilioNotFound = (e: any) =>
  e?.status === 404 || e?.code === 20404 || /not found/i.test(String(e?.message || ""));

/**
 * Terminal phone cleanup for a user whose CRM plan has been cancelled.
 *
 * Unlike the webhook path (which is keyed off a phone *subscription* and so
 * never touches trial numbers that were provisioned without one), this walks
 * the user's own `numbers` array, so a number is released even when it has no
 * Stripe subscription behind it. Phone subscriptions are cancelled immediately
 * rather than at period end because the number they billed for no longer
 * exists.
 */
export async function releaseUserPhoneNumbers(args: {
  userId: string;
  reason: string;
}): Promise<{ releasedNumbers: string[]; canceledPhoneSubscriptions: string[] }> {
  const { userId, reason } = args;
  const releasedNumbers: string[] = [];
  const canceledPhoneSubscriptions: string[] = [];

  const user = await User.findById(userId);
  if (!user) return { releasedNumbers, canceledPhoneSubscriptions };

  const email = String(user.email || "").toLowerCase().trim();

  if ((user as any).isOwner === true || (user as any).role === "owner") {
    log("skip owner account", { reason, email });
    return { releasedNumbers, canceledPhoneSubscriptions };
  }

  const numbers: any[] = Array.isArray((user as any).numbers)
    ? [...(user as any).numbers]
    : [];

  if (numbers.length) {
    let resolvedClient: Awaited<ReturnType<typeof getClientForUser>> | null = null;
    try {
      resolvedClient = await getClientForUser(email);
    } catch (e: any) {
      log("twilio client resolution failed; numbers left in place", {
        reason,
        email,
        message: e?.message || String(e),
      });
    }

    if (resolvedClient) {
      for (const number of numbers) {
        const phoneNumber = String(number.phoneNumber || "");
        const sid = String(number.sid || "").trim();
        try {
          if (sid) {
            await (resolvedClient.client as any).incomingPhoneNumbers(sid).remove();
          } else if (phoneNumber) {
            const matches = await resolvedClient.client.incomingPhoneNumbers.list({
              phoneNumber,
              limit: 1,
            });
            if (matches.length) {
              await (resolvedClient.client as any)
                .incomingPhoneNumbers(matches[0].sid)
                .remove();
            }
          }
        } catch (e: any) {
          // A number Twilio no longer knows about still needs its DB records
          // cleared; any other failure leaves the entry for the webhook backstop.
          if (!isTwilioNotFound(e)) {
            log("twilio release failed; number left in place", {
              reason,
              email,
              phoneNumber,
              message: e?.message || String(e),
            });
            continue;
          }
        }

        releasedNumbers.push(phoneNumber || sid);
        (user as any).numbers = ((user as any).numbers || []).filter(
          (n: any) => String(n._id) !== String(number._id),
        );
        if (String((user as any).defaultSmsNumberId || "") === String(number._id)) {
          (user as any).defaultSmsNumberId = null;
        }
        if (phoneNumber) {
          await PhoneNumber.deleteOne({ phoneNumber, userId: (user as any)._id });
        }
        log("number released", { reason, email, phoneNumber });
      }
      await user.save();
    }
  }

  // Cancel every phone add-on subscription immediately, including orphans that
  // no longer match an entry in user.numbers. Stripe does not invoice on an
  // immediate cancel, so no further phone charge is possible.
  const customerId = String((user as any).stripeCustomerId || "").trim();
  if (customerId) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
        expand: ["data.items.data.price"],
      });
      const phoneSubscriptions = subscriptions.data.filter(
        (subscription) =>
          isPhoneNumberSubscription(subscription) &&
          ["active", "trialing", "past_due", "incomplete"].includes(subscription.status),
      );
      for (const subscription of phoneSubscriptions) {
        try {
          await stripe.subscriptions.cancel(subscription.id);
          canceledPhoneSubscriptions.push(subscription.id);
          log("phone subscription canceled", { reason, email, subscriptionId: subscription.id });
        } catch (e: any) {
          log("phone subscription cancel failed", {
            reason,
            email,
            subscriptionId: subscription.id,
            message: e?.message || String(e),
          });
        }
      }
    } catch (e: any) {
      log("phone subscription listing failed", {
        reason,
        email,
        message: e?.message || String(e),
      });
    }
  }

  return { releasedNumbers, canceledPhoneSubscriptions };
}
