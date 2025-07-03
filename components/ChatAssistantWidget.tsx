import React, { useState } from "react";

export default function ChatAssistantWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ from: string; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

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
      if (data.reply) {
        setMessages((prev) => [...prev, { from: "assistant", text: data.reply }]);
      } else {
        setMessages((prev) => [...prev, { from: "assistant", text: "Sorry, no response." }]);
      }
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [...prev, { from: "assistant", text: "Error connecting to assistant." }]);
    }

    setLoading(false);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 bg-[#6b5b95] text-white px-4 py-2 rounded-full shadow-lg hover:bg-[#59487a] z-50"
      >
        {isOpen ? "Close Assistant" : "Ask Assistant"}
      </button>

      {isOpen && (
        <div className="fixed bottom-20 right-6 bg-gray-800 text-white w-80 h-96 p-4 rounded shadow-xl z-50 flex flex-col">
          <h3 className="font-bold mb-2">CoveCRM Assistant</h3>

          <div className="flex-1 overflow-y-auto mb-2 space-y-2">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`p-2 rounded ${
                  msg.from === "user" ? "bg-[#3b82f6] self-end" : "bg-gray-700 self-start"
                }`}
              >
                {msg.text}
              </div>
            ))}
            {loading && <div className="text-gray-400">Assistant is typing...</div>}
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
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}

