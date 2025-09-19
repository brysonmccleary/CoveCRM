// /components/messages/MessagesPanel.tsx
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import InboxSidebar from "./InboxSidebar";
import ChatThread from "./ChatThread";
import { connectAndJoin, disconnectSocket, getSocket } from "@/lib/socketClient";

export default function MessagesPanel() {
  const { data: session } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  useEffect(() => {
    const email = (session?.user?.email || "").toLowerCase();
    if (!email) return;

    const s = connectAndJoin(email);
    if (!s) return;

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);

    return () => {
      const sock = getSocket();
      if (!sock) return;
      sock.off("connect", onConnect);
      sock.off("disconnect", onDisconnect);
      // Do not force disconnect on every route change; only when unmounting app-wide.
      // If you WANT to fully close on unmount of this panel, uncomment next line:
      // disconnectSocket();
    };
  }, [session?.user?.email]);

  return (
    <div className="flex h-[calc(100vh-60px)]">
      {/* LEFT: Conversation List */}
      <div className="w-[350px] bg-[#1e293b] border-r border-gray-700">
        <InboxSidebar
          onSelect={setSelectedId}
          selectedId={selectedId}
          socket={getSocket()}
        />
      </div>

      {/* RIGHT: Chat Window */}
      <div className="flex-1 bg-[#0f172a]">
        {selectedId ? (
          <ChatThread leadId={selectedId} socket={getSocket()} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Select a conversation
          </div>
        )}
      </div>
    </div>
  );
}
