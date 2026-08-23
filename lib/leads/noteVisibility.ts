const AI_OUTCOME_HEADER = /^\s*\[AI[\s_-]*Dialer\s+Outcome\]/i;
const AI_OUTCOME_MARKER = /^\s*\[AI_DIALER_NOTES_APPLIED\]/i;
const AI_DIALER_LINE = /^\s*\[AI[\s_-]*Dialer(?:\s+fallback)?\]/i;
const INTERNAL_VOICE_METADATA =
  /\b(?:callSid|recordingSid|parentCallSid|dialCallSid|pstnCallSid|durationSec|answeredBy|twilio\s+status|outcome)\s*[:=]/i;

/**
 * Lead notes are customer-facing. Older AI dialer flows wrote operational
 * metadata into the same field, so strip those blocks at every read boundary.
 * The original database value is intentionally left intact for audit/recovery.
 */
export function sanitizeLeadNoteForDisplay(value: unknown): string {
  if (typeof value !== "string") return "";

  // Older hosted-funnel submissions serialized every answer, consent text,
  // and attribution source into Notes. Those values now live in structured
  // fields and immutable audit records, so never render the legacy dump as a
  // customer note.
  if (/^Source:\s*CoveCRM hosted funnel\b/im.test(value)) return "";

  const visibleLines: string[] = [];
  let insideAiOutcomeBlock = false;

  for (const rawLine of value.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();

    if (AI_OUTCOME_HEADER.test(line)) {
      insideAiOutcomeBlock = true;
      continue;
    }

    if (AI_OUTCOME_MARKER.test(line)) {
      insideAiOutcomeBlock = false;
      continue;
    }

    if (insideAiOutcomeBlock) continue;
    if (AI_DIALER_LINE.test(line)) continue;
    if (INTERNAL_VOICE_METADATA.test(line)) continue;

    visibleLines.push(rawLine.trimEnd());
  }

  return visibleLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
