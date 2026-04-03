import { useEffect, useMemo, useState } from "react";

type SupportChatModalProps = {
  isOpen: boolean;
  onClose: () => void;
  pageContext: string;
};

type SupportMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
};

function labelForPageContext(pageContext: string) {
  const key = String(pageContext || "").trim();
  if (!key) return "dashboard";
  return key.replace(/_/g, " ");
}

export default function SupportChatModal({
  isOpen,
  onClose,
  pageContext,
}: SupportChatModalProps) {
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setMessages([]);
    setInput("");
  }, [isOpen, pageContext]);

  const title = useMemo(() => labelForPageContext(pageContext), [pageContext]);

  const sendMessage = async () => {
    const clean = input.trim();
    if (!clean || sending) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: clean, createdAt: new Date().toISOString() },
    ]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/ai/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: clean,
          conversationId: conversationId || undefined,
          pageContext,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error || "Failed to get help");

      setConversationId(String(data?.conversationId || conversationId || ""));
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: String(data?.answer || "").trim() || "No response returned.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: err?.message || "Failed to get help.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#0f172a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">CoveCRM Support</h2>
            <p className="text-xs text-gray-400">Current screen: {title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-400 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="h-[420px] overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
              Ask a support question. The assistant can inspect your account setup and explain what to check next.
            </div>
          ) : (
            messages.map((message, idx) => (
              <div
                key={`${message.role}-${idx}-${message.createdAt || ""}`}
                className={`max-w-[85%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                  message.role === "user"
                    ? "ml-auto bg-blue-600 text-white"
                    : "bg-[#1e293b] text-gray-100"
                }`}
              >
                {message.content}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-white/10 px-5 py-4">
          <div className="flex gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              rows={3}
              placeholder="Describe the issue you're having..."
              className="flex-1 rounded-lg border border-white/10 bg-[#1e293b] px-3 py-2 text-sm text-white outline-none"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={sending || !input.trim()}
              className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
