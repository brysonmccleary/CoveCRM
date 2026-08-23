import { sanitizeLeadNoteForDisplay } from "@/lib/leads/noteVisibility";

describe("lead note visibility", () => {
  it("removes complete AI dialer audit blocks while preserving human notes", () => {
    const dirty = [
      "Customer asked us to call Friday afternoon.",
      "",
      "[AI Dialer Outcome] CallSid=CA123 • outcome=disconnected",
      "• Call ended — outcome not explicitly confirmed during call.",
      "• answeredBy: unknown. Lead left in original folder per policy.",
      "[AI_DIALER_NOTES_APPLIED] CallSid=CA123",
      "",
      "Prefers text before calling.",
    ].join("\n");

    expect(sanitizeLeadNoteForDisplay(dirty)).toBe(
      "Customer asked us to call Friday afternoon.\n\nPrefers text before calling.",
    );
  });

  it("removes fallback, voicemail, and standalone voice metadata", () => {
    const dirty = [
      "[AI Dialer fallback] CallSid=CA456 • outcome=unknown • Twilio status=completed, durationSec=27",
      "[AI Dialer] Voicemail detected (AMD) • CallSid=CA789 • AnsweredBy=machine",
      "RecordingSid=RE123",
    ].join("\n");

    expect(sanitizeLeadNoteForDisplay(dirty)).toBe("");
  });

  it("leaves ordinary notes unchanged", () => {
    const note = "Spoke with John.\nHe wants $250,000 in coverage.";
    expect(sanitizeLeadNoteForDisplay(note)).toBe(note);
  });

  it("hides legacy hosted-funnel answer dumps", () => {
    const legacyDump = [
      "Selected: $10k - $25k",
      "Lead Type: Veteran",
      "dob: 1997-12-01",
      "smsConsentText: long compliance disclosure",
      "Source: CoveCRM hosted funnel — General Veteran Leads",
    ].join("\n");

    expect(sanitizeLeadNoteForDisplay(legacyDump)).toBe("");
  });
});
