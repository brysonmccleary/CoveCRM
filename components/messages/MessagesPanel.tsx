// /components/messages/MessagesPanel.tsx
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import InboxSidebar, { Conversation, InboxMode } from "./InboxSidebar";
import ChatThread from "./ChatThread";
import { connectAndJoin, disconnectSocket, getSocket } from "@/lib/socketClient";

export default function MessagesPanel() {
  const { data: session } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [mode, setMode] = useState<InboxMode>("sms");
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);

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
    <div className="flex h-[calc(100vh-40px)] min-h-[620px] overflow-hidden rounded-xl border border-white/10 bg-[#0f172a]">
      {/* LEFT: Conversation List */}
      <div className={`${selectedId ? "hidden md:block" : "block"} w-full shrink-0 border-r border-gray-700 bg-[#1e293b] md:w-[380px]`}>
        <InboxSidebar
          onSelect={(id, conversation) => {
            setSelectedId(id);
            setSelectedConversation(conversation);
          }}
          selectedId={selectedId}
          socket={getSocket()}
          mode={mode}
          onModeChange={(m) => { setMode(m); setSelectedId(null); setSelectedConversation(null); }}
          showEmailToggle={false}
        />
      </div>

      {/* RIGHT: Chat Window */}
      <div className={`${selectedId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-[#0f172a]`}>
        {selectedId ? (
          <>
            <div className="flex min-h-16 items-center gap-3 border-b border-gray-800 px-4 py-3">
              <button
                type="button"
                onClick={() => { setSelectedId(null); setSelectedConversation(null); }}
                className="rounded-md border border-white/10 px-2 py-1 text-sm text-gray-300 hover:bg-white/10 md:hidden"
                aria-label="Back to conversations"
              >
                ←
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-white">{selectedConversation?.name || "Conversation"}</div>
                <div className="truncate text-xs text-gray-400">{selectedConversation?.phone || "No phone number"}</div>
              </div>
              <a
                href={`/lead/${encodeURIComponent(selectedId)}`}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-blue-300 transition hover:bg-white/5 hover:text-blue-200"
              >
                View lead
              </a>
            </div>
            <div className="min-h-0 flex-1">
              <ChatThread leadId={selectedId} socket={getSocket()} mode={mode} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-gray-400">
            <div>
              <div className="text-base font-semibold text-gray-300">Select a conversation</div>
              <div className="mt-1 text-sm text-gray-500">Choose a contact to review the thread and reply.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
