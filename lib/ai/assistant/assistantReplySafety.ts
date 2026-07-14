const TOOL_NAMES: Record<string, string> = {
  query_leads: "lead search",
  start_dial_session: "dial session",
  add_note_to_leads: "note update",
  move_leads_to_folder: "folder move",
  update_lead_status: "status update",
  bulk_text_leads: "text message",
  schedule_appointment: "appointment booking",
  manage_leads: "lead update",
  manage_folder: "folder update",
  create_reminder: "reminder",
  manage_drip_enrollment: "drip campaign update",
  control_dial_session: "dial session control",
  manage_appointment: "appointment update",
  crm_report: "CRM report",
  export_leads: "lead export",
};

/**
 * Last-line protection for user-visible assistant text. Tool results need
 * internal identifiers so later actions can target the right records, but
 * those identifiers and raw implementation details must never reach the UI.
 */
export function sanitizeAssistantReplyForUser(input: unknown): string {
  let reply = String(input || "");

  // Cove users never need source code or raw tool payloads in chat.
  reply = reply.replace(/```[\s\S]*?```/g, "");
  reply = reply.replace(/`([^`]+)`/g, "$1");

  // Remove the label and value together so redaction never leaves awkward
  // phrases such as "Lead ID: the selected lead".
  reply = reply.replace(
    /\b(lead|session|event|folder|call|campaign|enrollment)[ _-]?id\s*[:=#-]?\s*[A-Za-z0-9_-]{6,}\b/gi,
    (_match, kind: string) => `the ${String(kind).toLowerCase()}`,
  );

  // Common database/provider identifier formats.
  reply = reply.replace(/\b(?:CA|SM|MG|PN|AC|SK)[a-fA-F0-9]{32}\b/g, "the related record");
  reply = reply.replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/g, "the related record");
  reply = reply.replace(/\b[0-9a-fA-F]{24}\b/g, "the selected lead");
  reply = reply.replace(/\bcall_[A-Za-z0-9_-]{6,}\b/g, "the request");
  for (const [technical, friendly] of Object.entries(TOOL_NAMES)) {
    reply = reply.replace(new RegExp(`\\b${technical}\\b`, "gi"), friendly);
  }
  reply = reply
    .replace(/\bno_matching_leads\b/gi, "no matching leads")
    .replace(/\bconfirmationToken\b/gi, "confirmation")
    .replace(/\buserEmail\b/gi, "account")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return reply || "I could not format a clear response. Please try that request again.";
}
