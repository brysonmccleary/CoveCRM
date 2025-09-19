// /components/messages/InboxSidebar.tsx
import { useEffect, useState } from "react";
import axios from "axios";
import { Socket } from "socket.io-client";

interface Conversation {
  _id: string;
  name: string;
  phone: string;
  lastMessage: string;
  lastMessageTime: string;
  unread?: boolean;
  unreadCount?: number;
  lastMessageDirection?: string | null;
}

export default function InboxSidebar({
  onSelect,
  selectedId,
  socket,
}: {
  onSelect: (id: string) => void;
  selectedId: string | null;
  socket?: Socket | null;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = async () => {
    try {
      const res = await axios.get("/api/message/conversations");
      setConversations(res.data);
    } catch (err) {
      console.error("Failed to load conversations", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    if (!socket) return;

    const refresh = () => fetchConversations();

    // Outbound echo (local) and inbound (server) events
    socket.on("newMessage", refresh);
    socket.on("message:new", refresh);

    return () => {
      socket.off("newMessage", refresh);
      socket.off("message:new", refresh);
    };
  }, [socket]);

  return (
    <div className="w-[350px] bg-[#1e293b] h-full overflow-y-auto border-r border-gray-800">
      {loading && (
        <div className="p-4 text-gray-400 text-center">Loading…</div>
      )}
      {!loading && conversations.length === 0 && (
        <div className="p-4 text-gray-400 text-center">No conversations yet</div>
      )}

      {conversations.map((conv) => {
        const isActive = selectedId === conv._id;

        return (
          <div
            key={conv._id}
            onClick={() => onSelect(conv._id)}
            className={`cursor-pointer px-4 py-3 transition-colors duration-150 ${
              isActive ? "bg-[#334155] rounded-r-md" : "hover:bg-[#2d3b53]"
            }`}
          >
            <div className="flex justify-between items-center mb-1">
              <div className="font-semibold text-white truncate max-w-[220px]">
                {conv.name || conv.phone || "Unknown"}
              </div>
              <div className="text-xs text-gray-400 whitespace-nowrap">
                {new Date(conv.lastMessageTime).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            </div>
            <div className="text-sm text-gray-300 truncate">{conv.lastMessage}</div>
          </div>
        );
      })}
    </div>
  );
}
