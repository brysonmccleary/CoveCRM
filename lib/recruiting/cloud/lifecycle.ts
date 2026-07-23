export const HOSTED_SOCIAL_CONSENT_VERSION = "2026-07-16.hosted.1";

export type HostedAccountStatus = "connecting" | "active" | "reauth_required" | "paused" | "canceled";
export type HostedAccountEvent = "login_started" | "login_verified" | "login_failed" | "pause" | "resume" | "logout_detected" | "cancel";

const TRANSITIONS: Record<HostedAccountStatus, Partial<Record<HostedAccountEvent, HostedAccountStatus>>> = {
  connecting: { login_started: "connecting", login_verified: "active", login_failed: "reauth_required", pause: "paused", cancel: "canceled" },
  active: { login_started: "connecting", pause: "paused", logout_detected: "reauth_required", cancel: "canceled" },
  reauth_required: { login_started: "connecting", login_verified: "active", login_failed: "reauth_required", pause: "paused", cancel: "canceled" },
  paused: { login_started: "connecting", resume: "active", logout_detected: "reauth_required", cancel: "canceled" },
  canceled: {},
};

export function transitionHostedAccount(status: HostedAccountStatus, event: HostedAccountEvent): HostedAccountStatus {
  const next = TRANSITIONS[status]?.[event];
  if (!next) throw new Error(`Hosted account cannot transition from ${status} using ${event}.`);
  return next;
}

export function shouldRunHostedAccount(status: HostedAccountStatus): boolean {
  return status === "active";
}

export function sanitizeHostedAccount<T extends Record<string, any>>(account: T) {
  const safe = { ...account };
  delete safe.providerContextId;
  delete safe.loginSessionId;
  return safe;
}
