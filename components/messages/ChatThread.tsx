// components/messages/ChatThread.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Socket } from "socket.io-client";

interface Message {
  text: string;
  direction: "inbound" | "outbound" | "ai";
  leadId?: string;

  // old/optional
  date?: string;

  // ✅ what your API actually returns
  sentAt?: string;
  createdAt?: string;
  queuedAt?: string;
}

interface ChatThreadProps {
  leadId: string;
  socket: Socket | null;
}

function getAgentTimeZone(): string {
  // Matches iMessage on the agent's device because it uses device timezone.
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function startOfDayMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatThreadDividerIMessage(isoOrDate: string | Date, timeZone: string) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (!d || isNaN(d.getTime())) return "";

  const weekday = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    timeZone,
  }).format(d);

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(d);

  return `${weekday} ${time}`;
}

// ✅ normalize timestamp because API returns sentAt/createdAt not `date`
function getMsgIso(m: Message): string | undefined {
  return m.date || m.sentAt || m.createdAt || m.queuedAt;
}

export default function ChatThread({ leadId, socket }: ChatThreadProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const timeZone = useMemo(() => getAgentTimeZone(), []);

  const scrollToBottom = () =>
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);

  const fetchMessages = async () => {
    if (!leadId) return;
    const res = await axios.get(`/api/message/${leadId}`);
    setMessages(res.data);
    scrollToBottom();

    // Mark inbound unread as read for this thread
    try {
      await axios.post("/api/messages/mark-read", { leadId });
    } catch (e) {
      console.warn("mark-read failed (fetch)", e);
    }
  };

  useEffect(() => {
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (message: Message) => {
      if (message.leadId === leadId) {
        setMessages((prev) => [...prev, message]);
        scrollToBottom();

        if (message.direction === "inbound") {
          axios.post("/api/messages/mark-read", { leadId }).catch(() => {});
        }
      }
    };

    const handleServerMessageNew = (payload: Partial<Message> & { leadId?: string }) => {
      if (payload?.leadId === leadId) {
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
      <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col">
        {messages.map((msg, idx) => {
          const isSent = msg.direction === "outbound" || msg.direction === "ai";
          const base =
            "px-4 py-2 rounded-2xl text-sm max-w-[75%] w-fit whitespace-pre-wrap break-words shadow";
          const alignment = isSent
            ? "self-end ml-auto text-white bg-green-600"
            : "self-start text-white bg-[#334155]";

          // ✅ use normalized timestamp
          const curIso = getMsgIso(msg);
          const prev = idx > 0 ? messages[idx - 1] : null;
          const prevIso = prev ? getMsgIso(prev) : undefined;

          const curDate = curIso ? new Date(curIso) : null;
          const prevDate = prevIso ? new Date(prevIso) : null;

          const curDay =
            curDate && !isNaN(curDate.getTime()) ? startOfDayMs(curDate) : null;
          const prevDay =
            prevDate && !isNaN(prevDate.getTime()) ? startOfDayMs(prevDate) : null;

          const showDivider =
            !!curDay && (idx === 0 || (prevDay !== null && curDay !== prevDay));

          return (
            <div key={idx} className="flex flex-col gap-2">
              {showDivider && (
                <div className="w-full flex justify-center py-1">
                  <span className="text-xs text-gray-300 bg-[#111827] border border-gray-700 rounded-full px-3 py-1">
                    {curIso ? formatThreadDividerIMessage(curIso, timeZone) : ""}
                  </span>
                </div>
              )}

              <div className={`${base} ${alignment}`}>{msg.text}</div>
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
