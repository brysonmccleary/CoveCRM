// /components/messages/InboxSidebar.tsx
import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { Socket } from "socket.io-client";

export type InboxMode = "sms" | "email";

export interface Conversation {
  _id: string;
  name: string;
  phone: string;
  lastMessage: string;
  lastMessageTime: string;
  unread?: boolean;
  unreadCount?: number;
  lastMessageDirection?: string | null;
}

function getAgentTimeZone(): string {
  // Match iMessage on the agent's device (Mac) by using the browser/device timezone.
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function startOfDayMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatListStampIMessage(isoOrDate: string | Date, timeZone: string) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (!d || isNaN(d.getTime())) return "";

  const now = new Date();

  const dDay = startOfDayMs(d);
  const nowDay = startOfDayMs(now);
  const diffDays = Math.round((nowDay - dDay) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) {
    // Today -> time (iMessage style)
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(d);
  }

  if (diffDays === 1) return "Yesterday";

  if (diffDays >= 2 && diffDays <= 6) {
    // Within last 7 days -> weekday
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      timeZone,
    }).format(d);
  }

  // Older -> short date
  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    timeZone,
  }).format(d);
}

export default function InboxSidebar({
  onSelect,
  selectedId,
  socket,
  mode,
  onModeChange,
  showEmailToggle = true,
}: {
  onSelect: (id: string, conversation: Conversation) => void;
  selectedId: string | null;
  socket?: Socket | null;
  mode: InboxMode;
  onModeChange: (m: InboxMode) => void;
  showEmailToggle?: boolean;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const timeZone = useMemo(() => getAgentTimeZone(), []);
  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (filter === "unread" && !conversation.unread && !(conversation.unreadCount && conversation.unreadCount > 0)) {
        return false;
      }
      if (!normalizedQuery) return true;
      return [conversation.name, conversation.phone, conversation.lastMessage]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [conversations, filter, query]);

  const fetchConversations = async () => {
    setLoading(true);
    try {
      const url =
        mode === "email"
          ? "/api/email/conversations"
          : "/api/message/conversations";
      const res = await axios.get(url);
      setConversations(res.data);
    } catch (err) {
      console.error("Failed to load conversations", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!socket || mode !== "sms") return;

    const refresh = () => fetchConversations();

    socket.on("newMessage", refresh);
    socket.on("message:new", refresh);
    socket.on("message:read", refresh);
    return () => {
      socket.off("newMessage", refresh);
      socket.off("message:new", refresh);
      socket.off("message:read", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, mode]);

  return (
    <div className="flex h-full w-full flex-col border-r border-gray-800 bg-[#1e293b]">
      {/* SMS / Email toggle */}
      {showEmailToggle && (
        <div className="flex items-center gap-1 px-3 pt-3 pb-2">
          <button
            onClick={() => onModeChange("sms")}
            className={`flex-1 py-1.5 rounded-full text-sm font-medium transition-colors ${
              mode === "sms"
                ? "bg-green-600 text-white"
                : "bg-[#334155] text-gray-300 hover:bg-[#3e5068]"
            }`}
          >
            SMS
          </button>
          <button
            onClick={() => onModeChange("email")}
            className={`flex-1 py-1.5 rounded-full text-sm font-medium transition-colors ${
              mode === "email"
                ? "bg-blue-600 text-white"
                : "bg-[#334155] text-gray-300 hover:bg-[#3e5068]"
            }`}
          >
            Email
          </button>
        </div>
      )}

      <div className="space-y-2 border-b border-gray-800 px-3 pb-3 pt-3">
        <label className="sr-only" htmlFor="conversation-search">Search conversations</label>
        <input
          id="conversation-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations…"
          className="w-full rounded-lg border border-gray-700 bg-[#0f172a] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
        />
        <div className="flex items-center gap-1" aria-label="Conversation filters">
          {(["all", "unread"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              aria-pressed={filter === option}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition ${
                filter === option ? "bg-blue-600 text-white" : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              {option}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-500">{visibleConversations.length}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-gray-400 text-center">Loading…</div>
        )}
        {!loading && visibleConversations.length === 0 && (
          <div className="p-4 text-gray-400 text-center">
            {query || filter === "unread"
              ? "No conversations match this view."
              : `No ${mode === "email" ? "email threads" : "conversations"} yet`}
          </div>
        )}

        {visibleConversations.map((conv) => {
          const isActive = selectedId === conv._id;
          const stamp = formatListStampIMessage(conv.lastMessageTime, timeZone);

          return (
            <button
              type="button"
              key={conv._id}
              onClick={() => onSelect(conv._id, conv)}
              className={`block w-full px-4 py-3 text-left transition-colors duration-150 ${
                isActive ? "bg-[#334155] rounded-r-md" : "hover:bg-[#2d3b53]"
              }`}
              aria-current={isActive ? "true" : undefined}
            >
              <div className="flex justify-between items-center mb-1">
                <div className="font-semibold text-white truncate max-w-[220px]">
                  {conv.name || (conv as any).email || conv.phone || "Unknown"}
                </div>
                <div className="text-xs text-gray-400 whitespace-nowrap">
                  {stamp}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(conv.unread || (conv.unreadCount && conv.unreadCount > 0)) && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-label="Unread" />
                )}
                <div className="truncate text-sm text-gray-300">
                  {conv.lastMessage || "No messages yet"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
