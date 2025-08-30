// components/messages/ChatThread.tsx
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Socket } from "socket.io-client";

interface Message {
  text: string;
  direction: "inbound" | "outbound" | "ai";
  leadId?: string;
  date?: string;
}

interface ChatThreadProps {
  leadId: string;
  socket: Socket | null;
}

export default function ChatThread({ leadId, socket }: ChatThreadProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () =>
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);

  const fetchMessages = async () => {
    if (!leadId) return;
    const res = await axios.get(`/api/message/${leadId}`);
    setMessages(res.data);
    scrollToBottom();
  };

  useEffect(() => {
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    if (!socket) return;

    // Existing local event used by our own outbound flow
    const handleNewMessage = (message: Message) => {
      if (message.leadId === leadId) {
        setMessages((prev) => [...prev, message]);
        scrollToBottom();
      }
    };

    // NEW: Also react to server-emitted inbound event name
    const handleServerMessageNew = (payload: Partial<Message> & { leadId?: string }) => {
      if (payload?.leadId === leadId) {
        // Re-fetch to guarantee parity with server formatting/state
        fetchMessages();
      }
    };

    socket.on("newMessage", handleNewMessage);
    socket.on("message:new", handleServerMessageNew);

    return () => {
      socket.off("newMessage", handleNewMessage);
      socket.off("message:new", handleServerMessageNew);
    };
  }, [socket, leadId]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const res = await axios.post("/api/message", {
      leadId,
      text: input.trim(),
      direction: "outbound",
    });

    const message = res.data.message;
    setMessages((prev) => [...prev, message]);
    setInput("");
    socket?.emit("newMessage", { ...message, leadId });
    scrollToBottom();
  };

  return (
    <div className="flex flex-col h-full bg-[#0f172a]">
      {/* Make this a flex column so self-end works */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col">
        {messages.map((msg, idx) => {
          const isSent = msg.direction === "outbound" || msg.direction === "ai";
          const base =
            "px-4 py-2 rounded-2xl text-sm max-w-[75%] w-fit whitespace-pre-wrap break-words shadow";
          const alignment = isSent
            ? "self-end ml-auto text-white bg-green-600" // sent → right & green
            : "self-start text-white bg-[#334155]"; // received → left & slate

          return (
            <div key={idx} className={`${base} ${alignment}`}>
              {msg.text}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 border-t border-gray-800 flex gap-2 bg-[#0f172a]">
        <input
          className="flex-1 bg-[#1e293b] text-white border border-gray-700 rounded-full px-4 py-2 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-600"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type your message..."
        />
        <button
          onClick={sendMessage}
          className="bg-green-600 text-white px-5 rounded-full hover:bg-green-700 transition"
          aria-label="Send message"
        >
          Send
        </button>
      </div>
    </div>
  );
}
