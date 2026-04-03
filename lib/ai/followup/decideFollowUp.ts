type DecideFollowUpArgs = {
  lead: any;
  memoryProfile?: {
    nextBestAction?: string;
    objections?: string[];
    preferences?: Record<string, any>;
  } | null;
  stats: {
    lastInboundAt?: Date | null;
    lastOutboundAt?: Date | null;
    lastCallAt?: Date | null;
    lastAppointmentAt?: Date | null;
    followupCount: number;
    humanTextingActive: boolean;
  };
};

type FollowUpDecision = {
  shouldFollowUp: boolean;
  reason: string;
  suggestedAction: "sms" | "call" | "wait";
  suggestedMessage: string;
  suggestedDelayHours: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function hoursAgo(date?: Date | null) {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - date.getTime()) / (60 * 60 * 1000));
}

function normalizeStatus(lead: any) {
  return String(lead?.status || "").trim().toLowerCase();
}

function folderName(lead: any) {
  return String(lead?.folderName || lead?.folder || lead?.Folder || "").trim().toLowerCase();
}

function looksOptedOut(lead: any, objections: string[]) {
  const haystack = `${lead?.status || ""} ${lead?.lastInboundBody || ""} ${objections.join(" ")}`.toLowerCase();
  return (
    lead?.optOut === true ||
    lead?.unsubscribed === true ||
    haystack.includes(" stop") ||
    haystack.includes("not interested")
  );
}

function buildSuggestedMessage(args: {
  nextBestAction: string;
  objections: string[];
  preferences: Record<string, any>;
}) {
  const objection = args.objections.find(Boolean) || "";
  const preferredChannel = String(args.preferences?.preferred_channel || "").toLowerCase();
  const preferredTime =
    String(args.preferences?.preferred_contact_time || "") ||
    String(args.preferences?.callback_time || "");

  if (preferredChannel === "call" && preferredTime) {
    return `Wanted to follow up like you asked. Does ${preferredTime} still work for a quick call?`;
  }
  if (preferredTime) {
    return `Following up around the time you mentioned. Is now still good for a quick call?`;
  }
  if (objection) {
    return `Wanted to circle back on what you mentioned about ${objection}. Would a quick call help you decide next steps?`;
  }
  if (args.nextBestAction) {
    return `Just following up. ${args.nextBestAction}`;
  }
  return `Just checking in. Would you like to set up a quick call to go over options?`;
}

export function decideFollowUp(args: DecideFollowUpArgs): FollowUpDecision {
  const status = normalizeStatus(args.lead);
  const folder = folderName(args.lead);
  const nextBestAction = String(args.memoryProfile?.nextBestAction || "").trim();
  const objections = Array.isArray(args.memoryProfile?.objections)
    ? args.memoryProfile!.objections!.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const preferences =
    args.memoryProfile?.preferences && typeof args.memoryProfile.preferences === "object"
      ? args.memoryProfile.preferences
      : {};

  if (looksOptedOut(args.lead, objections)) {
    return {
      shouldFollowUp: false,
      reason: "Lead opted out or said stop.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  if (folder.includes("booked") || status.includes("booked")) {
    return {
      shouldFollowUp: false,
      reason: "Lead is booked.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  if (folder.includes("sold") || status.includes("sold")) {
    return {
      shouldFollowUp: false,
      reason: "Lead is sold.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  if (status.includes("not interested")) {
    return {
      shouldFollowUp: false,
      reason: "Lead is not interested.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  const lastMessageAt =
    args.stats.lastInboundAt && args.stats.lastOutboundAt
      ? new Date(Math.max(args.stats.lastInboundAt.getTime(), args.stats.lastOutboundAt.getTime()))
      : args.stats.lastInboundAt || args.stats.lastOutboundAt || null;

  if (lastMessageAt && Date.now() - lastMessageAt.getTime() < DAY_MS) {
    return {
      shouldFollowUp: false,
      reason: "Last message was less than 24 hours ago.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 24 - Math.floor(hoursAgo(lastMessageAt)),
    };
  }

  if (args.stats.followupCount >= 5) {
    return {
      shouldFollowUp: false,
      reason: "Lead already received 5 or more AI follow-ups.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  if (args.stats.humanTextingActive) {
    return {
      shouldFollowUp: false,
      reason: "Human texting is currently active.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 0,
    };
  }

  const lastTouchHours = Math.min(
    hoursAgo(args.stats.lastInboundAt),
    hoursAgo(args.stats.lastOutboundAt),
    hoursAgo(args.stats.lastCallAt)
  );

  if (args.stats.lastAppointmentAt && hoursAgo(args.stats.lastAppointmentAt) < 72) {
    return {
      shouldFollowUp: false,
      reason: "Lead has a recent appointment.",
      suggestedAction: "wait",
      suggestedMessage: "",
      suggestedDelayHours: 72 - Math.floor(hoursAgo(args.stats.lastAppointmentAt)),
    };
  }

  let suggestedAction: "sms" | "call" | "wait" = "sms";
  let suggestedDelayHours = 24;

  const loweredAction = nextBestAction.toLowerCase();
  if (loweredAction.includes("call")) {
    suggestedAction = "call";
    suggestedDelayHours = 24;
  } else if (loweredAction.includes("wait")) {
    suggestedAction = "wait";
    suggestedDelayHours = 48;
  } else if (status === "new") {
    suggestedAction = "sms";
    suggestedDelayHours = 24;
  } else if (status === "contacted") {
    suggestedAction = "call";
    suggestedDelayHours = 24;
  } else if (lastTouchHours > 72) {
    suggestedAction = "call";
    suggestedDelayHours = 12;
  }

  if (suggestedAction === "wait") {
    return {
      shouldFollowUp: false,
      reason: "Best action is to wait.",
      suggestedAction,
      suggestedMessage: "",
      suggestedDelayHours,
    };
  }

  return {
    shouldFollowUp: true,
    reason: nextBestAction || "Lead has gone quiet and is eligible for follow-up.",
    suggestedAction,
    suggestedMessage: buildSuggestedMessage({
      nextBestAction,
      objections,
      preferences,
    }),
    suggestedDelayHours,
  };
}
