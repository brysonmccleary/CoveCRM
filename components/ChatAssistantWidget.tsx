"use client";

import React, { useEffect, useRef, useState } from "react";
import { ASSISTANT_NAME } from "@/lib/assistantName";

export default function ChatAssistantWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ from: string; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Per-user display name with env fallback
  const [displayName, setDisplayName] = useState(ASSISTANT_NAME);

  // Load the user’s saved AI name; fallback to env if not set
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/settings/ai");
        if (!res.ok) return; // keep fallback silently
        const data = await res.json();
        if (mounted) {
          const name = (data?.aiAssistantName || ASSISTANT_NAME).trim();
          if (name) setDisplayName(name);
        }
      } catch {
        // silent fallback to ASSISTANT_NAME
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = { from: "user", text: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });

      const data = await res.json();
      const reply = data?.reply || "Sorry, no response.";

      // Simulate typing delay (1–2s)
      setTimeout(() => {
        setMessages((prev) => [...prev, { from: "assistant", text: reply }]);
        setLoading(false);
      }, 1000 + Math.floor(Math.random() * 1000)); // 1000–2000ms
    } catch (error) {
      console.error("Assistant Error:", error);
      setMessages((prev) => [
        ...prev,
        { from: "assistant", text: "Error connecting to assistant." },
      ]);
      setLoading(false);
    }
  };

  // Auto scroll to bottom on new message
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 bg-[#6b5b95] text-white px-4 py-2 rounded-full shadow-lg hover:bg-[#59487a] cursor-pointer z-50"
      >
        {isOpen ? `Close ${displayName}` : `Ask ${displayName}`}
      </button>

      {isOpen && (
        <div className="fixed bottom-20 right-6 bg-[#1e293b] text-white w-80 h-96 p-4 rounded shadow-xl z-50 flex flex-col">
          <h3 className="font-bold mb-2">{displayName}</h3>

          <div className="flex-1 overflow-y-auto mb-2 space-y-2 pr-1">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`p-2 rounded max-w-[80%] ${
                  msg.from === "user"
                    ? "bg-[#3b82f6] self-end ml-auto"
                    : "bg-gray-700 self-start mr-auto"
                }`}
              >
                {msg.text}
              </div>
            ))}
            {loading && (
              <div className="text-gray-400 italic">{displayName} is typing...</div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Type your message..."
              className="flex-1 p-2 rounded-l bg-gray-700 text-white focus:outline-none"
            />
            <button
              onClick={handleSend}
              className="bg-[#6b5b95] px-3 rounded-r hover:bg-[#59487a]"
              disabled={loading}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
