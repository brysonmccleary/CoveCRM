// /pages/conversations.tsx
import { useEffect, useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import axios from "axios";
import Link from "next/link";
import { useNotifStore } from "@/lib/notificationsStore";

interface Conversation {
  _id: string;
  name: string;
  phone: string;
  lastMessage: string;
  lastMessageTime: string;
  unread?: boolean; // legacy flag (fallback only)
}

function getAgentTimeZone(): string {
  // iMessage uses the device timezone; this matches that perfectly.
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

  // Compute "today" and "yesterday" boundaries in local device terms
  // (iMessage behavior). We still format output using Intl + timezone.
  const dDay = startOfDayMs(d);
  const nowDay = startOfDayMs(now);
  const diffDays = Math.round((nowDay - dDay) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) {
    // Today -> time
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

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  // 🔔 unread counts keyed by lead/conversation id
  const unreadByLead = useNotifStore((s) => s.unreadByLead);

  const fetchConversations = async () => {
    try {
      const res = await axios.get("/api/messages/conversations");
      setConversations(res.data);
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 10000); // Refresh every 10 sec
    return () => clearInterval(interval);
  }, []);

  // Optional: total unread badge in header
  const totalUnread = useMemo(
    () => Object.values(unreadByLead || {}).reduce((a, b) => a + (b || 0), 0),
    [unreadByLead]
  );

  const timeZone = useMemo(() => getAgentTimeZone(), []);

  return (
    <DashboardLayout>
      <div className="p-4">
        <div className="mb-4 flex items-center gap-2">
          <h1 className="text-2xl font-bold">Conversations</h1>
          {totalUnread > 0 && (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-pink-500 px-2 text-xs font-semibold text-white">
              {totalUnread}
            </span>
          )}
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : conversations.length === 0 ? (
          <p className="text-gray-500">No conversations yet.</p>
        ) : (
          <ul className="space-y-3 max-h-[80vh] overflow-y-auto pr-2">
            {conversations.map((conv) => {
              const unreadCount =
                (unreadByLead?.[conv._id] as number | undefined) ||
                (conv.unread ? 1 : 0); // fallback to legacy boolean if present

              const stamp = formatListStampIMessage(conv.lastMessageTime, timeZone);

              return (
                <li
                  key={conv._id}
                  className="bg-white shadow-sm rounded-lg p-4 border hover:bg-gray-50 transition relative"
                >
                  <Link href={`/messages/${conv._id}`}>
                    <div className="flex justify-between items-center">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{conv.name}</p>
                        <p className="text-gray-600 text-sm">{conv.phone}</p>
                        <p className="text-gray-800 mt-1 line-clamp-2">
                          {conv.lastMessage}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {stamp}
                        </span>
                        {unreadCount > 0 && (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-pink-500 px-1 text-xs font-semibold text-white">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DashboardLayout>
  );
}
