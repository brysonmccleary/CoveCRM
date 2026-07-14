// lib/sms/complianceFooter.ts
// Canonical opt-out compliance footer, extracted from lib/utils/scheduleReminders.ts
// so every automated/system-triggered SMS path shares one implementation instead
// of each new automation defining its own copy. Logic is unchanged — idempotent,
// case-insensitive check so a message that already contains the opt-out phrase
// is left as-is rather than getting it appended twice.
export function withStopFooter(msg: string): string {
  return /reply stop to opt out/i.test(msg) ? msg : `${msg} Reply STOP to opt out.`;
}
