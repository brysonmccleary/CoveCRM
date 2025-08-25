// /components/messages/MessagesPanel.tsx

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import InboxSidebar from "./InboxSidebar";
import ChatThread from "./ChatThread";

// Declare global socket instance
let socket: Socket | null = null;

export default function MessagesPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  useEffect(() => {
    if (!socket) {
      socket = io(undefined, {
        path: "/api/socket",
        transports: ["websocket"],
      });

      socket.on("connect", () => setSocketConnected(true));
      socket.on("disconnect", () => setSocketConnected(false));
    }

    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, []);

  return (
    <div className="flex h-[calc(100vh-60px)]">
      {/* LEFT: Conversation List (light blue) */}
      <div className="w-[350px] bg-[#1e293b] border-r border-gray-700">
        <InboxSidebar
          onSelect={setSelectedId}
          selectedId={selectedId}
          socket={socket}
        />
      </div>

      {/* RIGHT: Chat Window (dark blue) */}
      <div className="flex-1 bg-[#0f172a]">
        {selectedId ? (
          <ChatThread leadId={selectedId} socket={socket} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Select a conversation
          </div>
        )}
      </div>
    </div>
  );
}
