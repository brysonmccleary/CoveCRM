import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import axios from "axios";
import Link from "next/link";

interface Conversation {
  _id: string;
  name: string;
  phone: string;
  lastMessage: string;
  lastMessageTime: string;
  unread?: boolean; // optional unread flag
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <DashboardLayout>
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Conversations</h1>

        {loading ? (
          <p>Loading...</p>
        ) : conversations.length === 0 ? (
          <p className="text-gray-500">No conversations yet.</p>
        ) : (
          <ul className="space-y-3 max-h-[80vh] overflow-y-auto pr-2">
            {conversations.map((conv) => (
              <li
                key={conv._id}
                className="bg-white shadow-sm rounded-lg p-4 border hover:bg-gray-50 transition relative"
              >
                <Link href={`/messages/${conv._id}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold">{conv.name}</p>
                      <p className="text-gray-600 text-sm">{conv.phone}</p>
                      <p className="text-gray-800 mt-1">{conv.lastMessage}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {new Date(conv.lastMessageTime).toLocaleString()}
                      </span>
                      {conv.unread && (
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardLayout>
  );
}
