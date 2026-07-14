import { sanitizeAssistantReplyForUser } from "@/lib/ai/assistant/assistantReplySafety";

describe("assistant user-visible reply safety", () => {
  test("removes database, provider, UUID, and labeled record ids", () => {
    const reply = sanitizeAssistantReplyForUser(
      "Lead ID: 507f1f77bcf86cd799439011. Session ID sess_123456789. Call CA1234567890abcdef1234567890abcdef. Event 9d13c6b0-7a72-4c84-9b21-527ddc146533.",
    );
    expect(reply).not.toMatch(/507f1f77bcf86cd799439011|sess_123456789|CA1234567890abcdef1234567890abcdef|9d13c6b0/);
    expect(reply).not.toMatch(/lead id|session id/i);
  });

  test("removes code blocks and translates tool names and internal result codes", () => {
    const reply = sanitizeAssistantReplyForUser(
      "query_leads returned no_matching_leads. ```json\n{\"confirmationToken\":\"secret\"}\n```",
    );
    expect(reply).toBe("lead search returned no matching leads.");
    expect(reply).not.toContain("{");
  });

  test("leaves normal names, phone numbers, counts, and explanations intact", () => {
    const reply = "I found 12 leads. Jane Smith's phone number is (808) 555-1212.";
    expect(sanitizeAssistantReplyForUser(reply)).toBe(reply);
  });
});
