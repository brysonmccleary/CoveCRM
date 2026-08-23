const PAYMENT_MESSAGE =
  "Your Meta ad account needs a payment method before this campaign can launch.";

const RECONNECT_MESSAGE =
  "Reconnect Facebook in CoveCRM, then try again.";

const PERMISSION_MESSAGE =
  "Facebook needs one more account permission before CoveCRM can finish this action.";

const CREATIVE_USED_MESSAGE =
  "That exact ad was just reserved or launched by another agent. Regenerate once to receive a fresh set.";

export const META_LAUNCH_ERROR_MESSAGE =
  "Facebook couldn’t finish creating the ad. Nothing was activated. Please try Launch again.";

export const META_ACTIVATION_ERROR_MESSAGE =
  "Facebook couldn’t activate the campaign. It is still paused. Please try again.";

export const META_BUDGET_ERROR_MESSAGE =
  "Facebook couldn’t update the budget. Your previous budget is unchanged. Please try again.";

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value || "");
  } catch {
    return "";
  }
}

function sharedPublicMessage(value: unknown): string | null {
  const text = errorText(value).toLowerCase();
  if (
    text.includes("exact ad was just reserved") ||
    text.includes("same creative twice") ||
    text.includes("creative uniqueness")
  ) {
    return CREATIVE_USED_MESSAGE;
  }
  if (
    text.includes("1359188") ||
    text.includes("funding source") ||
    text.includes("payment method")
  ) {
    return PAYMENT_MESSAGE;
  }
  if (
    text.includes("access token") ||
    text.includes("code\":190") ||
    text.includes("code: 190") ||
    text.includes("session has expired") ||
    text.includes("reconnect")
  ) {
    return RECONNECT_MESSAGE;
  }
  if (
    text.includes("permission") ||
    text.includes("not authorized") ||
    text.includes("does not have access")
  ) {
    return PERMISSION_MESSAGE;
  }
  return null;
}

export function getMetaLaunchPublicMessage(value: unknown): string {
  return sharedPublicMessage(value) || META_LAUNCH_ERROR_MESSAGE;
}

export function getMetaActivationPublicMessage(value: unknown): string {
  return sharedPublicMessage(value) || META_ACTIVATION_ERROR_MESSAGE;
}

export function getMetaBudgetPublicMessage(value: unknown): string {
  return sharedPublicMessage(value) || META_BUDGET_ERROR_MESSAGE;
}

export function buildMetaCreativeEnhancementSpec() {
  return {
    creative_features_spec: {
      // Meta removed the old `multi_advertiser_ads` and
      // `standard_enhancements` keys. This is the currently accepted catalog
      // enhancement key and keeps automatic creative changes opted out.
      standard_enhancements_catalog: { enroll_status: "OPT_OUT" },
    },
  };
}
