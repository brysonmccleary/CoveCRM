type DecideReactivationArgs = {
  lead: any;
  folderName?: string | null;
  memoryProfile?: {
    shortSummary?: string;
    nextBestAction?: string;
    objections?: string[];
    preferences?: Record<string, any>;
  } | null;
  stats: {
    lastInboundAt?: Date | null;
    lastOutboundAt?: Date | null;
    lastCallAt?: Date | null;
    lastAppointmentAt?: Date | null;
    reactivationCount: number;
    humanTextingActive: boolean;
  };
};

type ReactivationDecision = {
  shouldReactivate: boolean;
  reason: string;
  suggestedAction: "sms" | "call" | "wait";
  suggestedMessage: string;
  suggestedDelayHours: number;
};

const REACTIVATION_MS = 30 * 24 * 60 * 60 * 1000;

function normalize(value: any) {
  return String(value || "").trim().toLowerCase();
}

function mostRecentDate(dates: Array<Date | null | undefined>) {
  const valid = dates.filter((date): date is Date => !!date);
  if (!valid.length) return null;
  return new Date(Math.max(...valid.map((date) => date.getTime())));
}

function daysAgo(date?: Date | null) {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - date.getTime()) / REACTIVATION_MS) * 30;
}

function hasStopSignal(lead: any, objections: string[], summary: string) {
  const haystack = `${lead?.status || ""} ${lead?.lastInboundBody || ""} ${summary} ${objections.join(" ")}`.toLowerCase();
  return (
    lead?.optOut === true ||
    lead?.unsubscribed === true ||
    haystack.includes("stop") ||
    haystack.includes("opt out")
  );
}

function buildSuggestedMessage(args: {
  nextBestAction: string;
  objections: string[];
  preferences: Record<string, any>;
  previouslyInterested: boolean;
}) {
  const preferredTime =
    String(args.preferences?.preferred_contact_time || "") ||
    String(args.preferences?.callback_time || "");
  const preferredChannel = String(args.preferences?.preferred_channel || "").toLowerCase();
  const topObjection = args.objections.find(Boolean) || "";

  if (preferredChannel === "call" && preferredTime) {
    return `Checking back in since timing can change. Would ${preferredTime} still work for a quick call?`;
  }
  if (preferredTime) {
    return `Just checking back in since timing can change. Is ${preferredTime} still a good time for a quick call?`;
  }
  if (args.previouslyInterested) {
    return `Just wanted to check back in since timing can change. Are you still open to a quick call to go over options?`;
  }
  if (topObjection) {
    return `Checking back in since timing can change. If ${topObjection} was the main hold-up before, would a quick call be worth revisiting?`;
  }
  if (args.nextBestAction) {
    return `Checking back in since timing can change. ${args.nextBestAction}`;
  }
  return `Just wanted to check back in since timing can change. Are you still open to a quick call to go over options?`;
}

export function decideReactivation(args: DecideReactivationArgs): ReactivationDecision {
  const status = normalize(args.lead?.status);
  const folder = normalize(args.folderName);
  const nextBestAction = String(args.memoryProfile?.nextBestAction || "").trim();
  const shortSummary = String(args.memoryProfile?.shortSummary || "").trim();
  const objections = Array.isArray(args.memoryProfile?.objections)
    ? args.memoryProfile!.objections!.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const preferences =
    args.memoryProfile?.preferences && typeof args.memoryProfile.preferences === "object"
      ? args.memoryProfile.preferences
      : {};

  if (hasStopSignal(args.lead, objections, shortSummary)) {
    return {
      shouldReactivate: false,
      reason: "Lead opted out or sent a stop signal.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  if (status.includes("booked") || folder.includes("booked")) {
    return {
      shouldReactivate: false,
      reason: "Lead is booked.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  if (status.includes("sold") || folder.includes("sold")) {
    return {
      shouldReactivate: false,
      reason: "Lead is sold.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  if (status.includes("bad number") || folder.includes("bad number")) {
    return {
      shouldReactivate: false,
      reason: "Lead is marked bad number.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  if (args.stats.humanTextingActive) {
    return {
      shouldReactivate: false,
      reason: "Human texting suppression is active.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  if (args.stats.reactivationCount >= 3) {
    return {
      shouldReactivate: false,
      reason: "Lead already has 3 or more reactivation attempts.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  const lastMessageAt = mostRecentDate([args.stats.lastInboundAt, args.stats.lastOutboundAt]);
  if (lastMessageAt && Date.now() - lastMessageAt.getTime() < REACTIVATION_MS) {
    return {
      shouldReactivate: false,
      reason: "Last message was less than 30 days ago.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: Math.ceil(30 - daysAgo(lastMessageAt)),
    };
  }

  if (args.stats.lastAppointmentAt && Date.now() - args.stats.lastAppointmentAt.getTime() < REACTIVATION_MS) {
    return {
      shouldReactivate: false,
      reason: "Lead has an appointment within the last 30 days.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: Math.ceil(30 - daysAgo(args.stats.lastAppointmentAt)),
    };
  }

  const lastMeaningfulActivityAt = mostRecentDate([
    args.stats.lastInboundAt,
    args.stats.lastOutboundAt,
    args.stats.lastCallAt,
    args.stats.lastAppointmentAt,
  ]);

  if (lastMeaningfulActivityAt && Date.now() - lastMeaningfulActivityAt.getTime() < REACTIVATION_MS) {
    return {
      shouldReactivate: false,
      reason: "Lead had meaningful activity within the last 30 days.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: Math.ceil(30 - daysAgo(lastMeaningfulActivityAt)),
    };
  }

  const previouslyInterested =
    /interested|book|appointment|callback|follow up/i.test(`${nextBestAction} ${shortSummary}`) ||
    status.includes("contacted");
  const previouslyNotInterested =
    status.includes("not interested") || objections.some((item) => /not interested|stop|already covered/i.test(item));
  const veryOld = !lastMeaningfulActivityAt || Date.now() - lastMeaningfulActivityAt.getTime() >= 90 * 24 * 60 * 60 * 1000;

  if (previouslyNotInterested && !veryOld) {
    return {
      shouldReactivate: false,
      reason: "Lead was previously not interested and is not old enough to retry.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 24 * 30,
    };
  }

  let suggestedAction: "sms" | "call" | "wait" = "sms";
  let suggestedDelayHours = 24;

  if (previouslyInterested) {
    suggestedAction = "sms";
    suggestedDelayHours = 6;
  }

  if (/call/i.test(nextBestAction) && previouslyInterested) {
    suggestedAction = "call";
    suggestedDelayHours = 12;
  }

  return {
    shouldReactivate: true,
    reason: previouslyInterested
      ? "Lead was previously interested and has been inactive for at least 30 days."
      : "Lead is inactive for at least 30 days and is eligible for reactivation.",
    suggestedAction,
    suggestedMessage: buildSuggestedMessage({
      nextBestAction,
      objections,
      preferences,
      previouslyInterested,
    }),
    suggestedDelayHours,
  };
}
