import BillingMeterHealth from "@/models/BillingMeterHealth";

const DEFAULT_MAX_HEALTH_AGE_MS = 15 * 60 * 1000;

function maxHealthAgeMs() {
  const configured = Number(process.env.BILLING_METER_MAX_AGE_MINUTES || 15);
  const minutes = Number.isFinite(configured) && configured >= 5 ? configured : 15;
  return minutes * 60 * 1000;
}

export async function initializeBillingMeter(args: {
  accountSid: string;
  userEmail: string;
  now?: Date;
  cutoverAt?: Date;
  healthy?: boolean;
}) {
  const now = args.now || new Date();
  const cutoverAt = args.cutoverAt || now;
  return BillingMeterHealth.findOneAndUpdate(
    { accountSid: args.accountSid },
    {
      $setOnInsert: {
        accountSid: args.accountSid,
        status: args.healthy ? "healthy" : "pending",
        cutoverAt,
        discoveryCursorAt: cutoverAt,
        lastAttemptAt: args.healthy ? now : null,
        lastSucceededAt: args.healthy ? now : null,
        consecutiveFailures: 0,
      },
      $set: { userEmail: args.userEmail.toLowerCase() },
    },
    { upsert: true, new: true },
  );
}

export async function markBillingMeterWebhookSeen(accountSid: string) {
  if (!accountSid) return;
  await BillingMeterHealth.updateOne(
    { accountSid },
    { $set: { lastWebhookAt: new Date() } },
  );
}

export async function checkBillingMeterHealthy(args: {
  accountSid: string;
  now?: Date;
}) {
  const now = args.now || new Date();
  if (!args.accountSid) {
    return { ok: false as const, reason: "Calling account is not assigned to a Twilio subaccount." };
  }

  const health = await BillingMeterHealth.findOne({ accountSid: args.accountSid })
    .select("status lastSucceededAt lastError")
    .lean<any>();
  if (!health?.lastSucceededAt) {
    return { ok: false as const, reason: "Usage metering is initializing. Please try again in a few minutes." };
  }

  const succeededAt = new Date(health.lastSucceededAt).getTime();
  const ageMs = now.getTime() - succeededAt;
  const allowedAge = maxHealthAgeMs() || DEFAULT_MAX_HEALTH_AGE_MS;
  if (health.status !== "healthy" || !Number.isFinite(ageMs) || ageMs > allowedAge) {
    return {
      ok: false as const,
      reason: "Calling is temporarily paused because usage metering is not current.",
    };
  }

  return { ok: true as const };
}
