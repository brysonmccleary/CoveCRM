import fs from "fs";
import path from "path";

describe("sidebar assistant endpoint path", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "components/Sidebar.tsx"), "utf8");

  test("posts to the real chat-assistant endpoint, not the nonexistent one", () => {
    expect(source).toContain('fetch("/api/chat-assistant"');
    expect(source).not.toContain("/api/ai/assistant");
  });

  test("sends the message plus conversation and pending-confirmation context", () => {
    const fetchBlock = source.slice(source.indexOf('fetch("/api/chat-assistant"'), source.indexOf('fetch("/api/chat-assistant"') + 300);
    expect(fetchBlock).toContain("JSON.stringify({ message: msg, history, pendingBulkTextConfirmation, pendingActionConfirmation })");
  });

  test("chat-assistant.ts reads the message and returns the reply with confirmation state", () => {
    const handlerSource = fs.readFileSync(path.join(process.cwd(), "pages/api/chat-assistant.ts"), "utf8");
    expect(handlerSource).toContain("const { message } = req.body");
    expect(handlerSource).toContain("pendingBulkTextConfirmation: nextBulkTextConfirmation || null");
  });
});
