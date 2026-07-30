export const RECRUITING_PUBLIC_MESSAGES = {
  ACCOUNT_CONNECTION_UNAVAILABLE: "Account connections are temporarily unavailable. Please try again shortly.",
  ACCOUNT_LOGIN_NOT_FINISHED: "Finish logging in before continuing.",
  ACCOUNT_LOGIN_EXPIRED: "That login window has ended. Start connecting again.",
  ACCOUNT_VERIFY_FAILED: "We couldn’t confirm the login. Please try connecting again.",
  ACCOUNT_LANGUAGE_UNSUPPORTED: "Set this social account’s language to English in its settings, then finish connecting. Automation currently supports English-language accounts only.",
  ACCOUNT_LOAD_FAILED: "We couldn’t load your connected accounts. Refresh the page and try again.",
  ACCOUNT_UPDATE_FAILED: "We couldn’t update this account. Please try again.",
  CAMPAIGN_START_FAILED: "We couldn’t start your campaign. Please try again.",
  CAMPAIGN_LOAD_FAILED: "We couldn’t load your campaigns. Refresh the page and try again.",
  CAMPAIGN_INPUT_INVALID: "Review the campaign details and try again.",
  SIMULATION_FAILED: "We couldn’t complete that test. Review the details and try again.",
} as const;

export type RecruitingPublicErrorCode = keyof typeof RECRUITING_PUBLIC_MESSAGES;

export class RecruitingPublicError extends Error {
  code: RecruitingPublicErrorCode;

  constructor(code: RecruitingPublicErrorCode, message?: string) {
    super(message || RECRUITING_PUBLIC_MESSAGES[code]);
    this.name = "RecruitingPublicError";
    this.code = code;
  }
}

export function recruitingErrorPayload(error: unknown, fallbackCode: RecruitingPublicErrorCode) {
  if (error instanceof RecruitingPublicError) {
    return { code: error.code, error: error.message };
  }
  return { code: fallbackCode, error: RECRUITING_PUBLIC_MESSAGES[fallbackCode] };
}

export function recruitingErrorMessage(payload: unknown, fallbackCode: RecruitingPublicErrorCode): string {
  const code = payload && typeof payload === "object" && "code" in payload
    ? String((payload as { code?: unknown }).code || "") as RecruitingPublicErrorCode
    : fallbackCode;
  return Object.prototype.hasOwnProperty.call(RECRUITING_PUBLIC_MESSAGES, code)
    ? RECRUITING_PUBLIC_MESSAGES[code]
    : RECRUITING_PUBLIC_MESSAGES[fallbackCode];
}
