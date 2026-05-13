import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import { connectAndJoin } from "@/lib/socketClient";

const EXPERIMENTAL_ADMIN = "bryson.mccleary1@gmail.com";

export default function Sidebar() {
  const { data: session } = useSession();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<any[]>([]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const isAdmin = (session?.user?.email ?? "").toLowerCase() === EXPERIMENTAL_ADMIN;
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchUnread = async () => {
    try {
      const res = await fetch("/api/conversations/unread-count");
      const data = await res.json();
      if (res.ok && typeof data.count === "number") setUnreadCount(data.count);
    } catch (err) {
      console.error("Failed to fetch unread count", err);
    }
  };

  // Initial fetch + polling
  useEffect(() => {
    fetchUnread();
    intervalRef.current = setInterval(fetchUnread, 15000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Live updates via socket
  useEffect(() => {
    const email = (session?.user?.email || "").toLowerCase();
    if (!email) return;

    const s = connectAndJoin(email);
    const refetch = () => fetchUnread();

    s?.on("message:new", refetch);
    s?.on("message:read", refetch);
    s?.on("conversation:updated", refetch);

    return () => {
      s?.off("message:new", refetch);
      s?.off("message:read", refetch);
      s?.off("conversation:updated", refetch);
    };
  }, [session?.user?.email]);

  const badge = (count: number) =>
    count > 0 && (
      <span
        className="ml-2 inline-flex items-center justify-center text-xs font-bold bg-red-600 text-white rounded-full px-2 py-0.5"
        aria-label={`${count} unread messages`}
      >
        {count > 99 ? "99+" : count}
      </span>
    );

  const isActiveHref = (href: string) => {
    if (router.asPath === href) return true;
    if (href.startsWith("/dashboard?tab=")) {
      const tab = href.split("tab=")[1] || "";
      return router.pathname === "/dashboard" && String(router.query.tab || "") === tab;
    }
    return router.pathname === href;
  };

  const getNavStyle = (href: string) => {
    const active = isActiveHref(href);
    return {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 12px",
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 500,
      color: active ? "#e2e8f0" : "#94a3b8",
      textDecoration: "none",
      transition: "background 0.15s",
      borderLeft: active ? "2px solid #2563eb" : "2px solid transparent",
      paddingLeft: active ? 10 : 12,
      background: active ? "#1a2535" : "transparent",
    };
  };

  const setHoverBackground = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!isActiveHref(href)) event.currentTarget.style.background = "#1e2d45";
  };

  const clearHoverBackground = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    event.currentTarget.style.background = isActiveHref(href) ? "#1a2535" : "transparent";
  };

  const navIconStyle = { fontSize: 15, width: 20, textAlign: "center" as const, flexShrink: 0 };

  return (
    <div className="bg-[#0f172a] text-white w-60 p-4 min-h-screen flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 mb-6">
          <Image
            src="/logo.png"
            alt="Cove CRM Logo"
            width={32}
            height={32}
            className="rounded"
            priority
          />
          <h1 className="text-xl font-bold">Cove CRM</h1>
        </div>

        <nav className="space-y-2">
          <Link
            href="/dashboard?tab=home"
            style={getNavStyle("/dashboard?tab=home")}
            onMouseEnter={(event) => setHoverBackground(event, "/dashboard?tab=home")}
            onMouseLeave={(event) => clearHoverBackground(event, "/dashboard?tab=home")}
          >
            <span style={navIconStyle}>🏠</span>
            <span>Home</span>
          </Link>
          <Link
            href="/dashboard?tab=leads"
            style={getNavStyle("/dashboard?tab=leads")}
            onMouseEnter={(event) => setHoverBackground(event, "/dashboard?tab=leads")}
            onMouseLeave={(event) => clearHoverBackground(event, "/dashboard?tab=leads")}
          >
            <span style={navIconStyle}>📁</span>
            <span>Folders</span>
          </Link>
          <Link
            href="/dashboard?tab=drip-campaigns"
            style={getNavStyle("/dashboard?tab=drip-campaigns")}
            onMouseEnter={(event) => setHoverBackground(event, "/dashboard?tab=drip-campaigns")}
            onMouseLeave={(event) => clearHoverBackground(event, "/dashboard?tab=drip-campaigns")}
          >
            <span style={navIconStyle}>📧</span>
            <span>Drip Campaigns</span>
          </Link>

          <Link
            href="/dashboard?tab=conversations"
            style={getNavStyle("/dashboard?tab=conversations")}
            onMouseEnter={(event) => setHoverBackground(event, "/dashboard?tab=conversations")}
            onMouseLeave={(event) => clearHoverBackground(event, "/dashboard?tab=conversations")}
          >
            <span style={navIconStyle}>💬</span>
            <span>Conversations</span>{badge(unreadCount)}
          </Link>

          <Link
            href="/dashboard?tab=calendar"
            style={getNavStyle("/dashboard?tab=calendar")}
            onMouseEnter={(event) => setHoverBackground(event, "/dashboard?tab=calendar")}
            onMouseLeave={(event) => clearHoverBackground(event, "/dashboard?tab=calendar")}
          >
            <span style={navIconStyle}>📅</span>
            <span>Calendar</span>
          </Link>
          <Link
            href="/dashboard?tab=numbers"
            style={getNavStyle("/dashboard?tab=numbers")}
            onMouseEnter={(event) => setHoverBackground(event, "/dashboard?tab=numbers")}
            onMouseLeave={(event) => clearHoverBackground(event, "/dashboard?tab=numbers")}
          >
            <span style={navIconStyle}>📞</span>
            <span>Numbers</span>
          </Link>
          {isAdmin && (
            <Link
              href="/facebook-leads"
              style={getNavStyle("/facebook-leads")}
              onMouseEnter={(event) => setHoverBackground(event, "/facebook-leads")}
              onMouseLeave={(event) => clearHoverBackground(event, "/facebook-leads")}
            >
              <span style={navIconStyle}>📣</span>
              <span>FB Leads</span>
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/recruiting"
              style={getNavStyle("/recruiting")}
              onMouseEnter={(event) => setHoverBackground(event, "/recruiting")}
              onMouseLeave={(event) => clearHoverBackground(event, "/recruiting")}
            >
              <span style={navIconStyle}>🎯</span>
              <span>Recruiting</span>
            </Link>
          )}
          <Link
            href="/dashboard?tab=settings"
            style={getNavStyle("/dashboard?tab=settings")}
            onMouseEnter={(event) => setHoverBackground(event, "/dashboard?tab=settings")}
            onMouseLeave={(event) => clearHoverBackground(event, "/dashboard?tab=settings")}
          >
            <span style={navIconStyle}>⚙️</span>
            <span>Settings</span>
          </Link>
        </nav>
      </div>

      <div className="mt-8 space-y-3">
        <button
          onClick={() => setAssistantOpen(true)}
          className="w-full rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          ✨ Ask Assistant
        </button>
        <button
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className="block text-red-500 hover:underline"
          aria-label="Log out and return to Home"
        >
          Log Out
        </button>
      </div>

      {assistantOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40">
          <div className="w-[380px] h-[520px] bg-[#0b1220] border border-white/10 rounded-xl m-6 flex flex-col">
            <div className="p-3 border-b border-white/10 flex justify-between items-center">
              <div className="text-sm font-semibold">Cove AI Assistant</div>
              <button onClick={() => setAssistantOpen(false)}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {assistantMessages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                  <div className={m.role === "user"
                    ? "inline-block bg-indigo-600 px-3 py-2 rounded-lg text-sm"
                    : "inline-block bg-white/10 px-3 py-2 rounded-lg text-sm"}>
                    {m.content}
                  </div>
                </div>
              ))}
              {assistantLoading && <div className="text-xs text-white/50">Thinking...</div>}
            </div>

            <div className="p-3 border-t border-white/10 flex gap-2">
              <input
                value={assistantInput}
                onChange={(e) => setAssistantInput(e.target.value)}
                placeholder="Ask anything..."
                className="flex-1 bg-white/10 rounded-lg px-3 py-2 text-sm outline-none"
              />
              <button
                onClick={async () => {
                  if (!assistantInput.trim()) return;
                  const msg = assistantInput;
                  setAssistantInput("");
                  setAssistantMessages(m => [...m, { role: "user", content: msg }]);
                  setAssistantLoading(true);

                  const res = await fetch("/api/ai/assistant", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: msg }),
                  });

                  const data = await res.json();
                  setAssistantMessages(m => [...m, { role: "assistant", content: data.reply }]);
                  setAssistantLoading(false);
                }}
                className="bg-indigo-600 px-3 py-2 rounded-lg text-sm"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
