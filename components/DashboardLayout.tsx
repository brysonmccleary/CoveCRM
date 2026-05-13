// components/DashboardLayout.tsx
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { connectAndJoin } from "@/lib/socketClient";
import IncomingCallBanner from "@/components/IncomingCallBanner"; // ← NEW
import Link from "next/link";
import { useRouter } from "next/router";
import SupportChatModal from "@/components/SupportChatModal";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

interface Nudge {
  _id: string;
  leadName: string;
  message: string;
  priority: "high" | "medium" | "low";
  leadId: string;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const isAdmin = session?.user?.email?.toLowerCase() === ADMIN_EMAIL;

  const links = [
    { name: "Home", path: "/dashboard?tab=home" },
    { name: "Folders", path: "/dashboard?tab=leads" },
    { name: "Drip Campaigns", path: "/dashboard?tab=drip-campaigns" },
    { name: "Conversations", path: "/dashboard?tab=conversations" },
    { name: "Calendar", path: "/dashboard?tab=calendar" },
    { name: "Numbers", path: "/dashboard?tab=numbers" },
    ...(isAdmin ? [{ name: "FB Leads", path: "/facebook-leads" }] : []),
    // gated below
    { name: "Team", path: "/team" },
    { name: "Settings", path: "/dashboard?tab=settings" },
    ...(isAdmin ? [
      { name: "Recruiting", path: "/recruiting" },
      { name: "Admin: AI Copilot", path: "/admin/ai-copilot" },
      { name: "Admin: Prospecting", path: "/admin/prospecting" },
      { name: "Admin: Site Intelligence", path: "/admin/site-intelligence" },
    ] : []),
  ];

  const fetchUnread = async () => {
    try {
      const res = await fetch("/api/conversations/unread-count");
      const data = await res.json();
      if (res.ok && typeof data.count === "number") setUnreadCount(data.count);
    } catch (err) {
      console.error("Unread fetch error:", err);
    }
  };

  const fetchNudges = async () => {
    try {
      const res = await fetch("/api/nudges");
      if (res.ok) {
        const data = await res.json();
        setNudges(data.nudges || []);
      }
    } catch {}
  };

  const dismissNudge = async (nudgeId: string) => {
    setNudges((prev) => prev.filter((n) => n._id !== nudgeId));
    await fetch("/api/nudges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nudgeId, action: "dismiss" }),
    }).catch(() => {});
  };

  // Initial fetch + polling
  useEffect(() => {
    fetchUnread();
    fetchNudges();
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
      <span className="ml-2 text-xs font-bold bg-red-600 text-white rounded-full px-2 py-0.5">
        {count > 99 ? "99+" : count}
      </span>
    );

  const NAV_ICONS: Record<string, string> = {
    "Home": "🏠",
    "Folders": "📁",
    "Drip Campaigns": "📧",
    "Conversations": "💬",
    "Calendar": "📅",
    "Numbers": "📞",
    "FB Leads": "📣",
    "Team": "👥",
    "Settings": "⚙️",
    "Recruiting": "🎯",
    "Admin: AI Copilot": "🤖",
    "Admin: Prospecting": "🔍",
    "Admin: Site Intelligence": "📊",
  };

  const isActivePath = (path: string) => {
    if (router.asPath === path) return true;
    if (path.startsWith("/dashboard?tab=")) {
      const tab = path.split("tab=")[1] || "";
      return router.pathname === "/dashboard" && String(router.query.tab || "") === tab;
    }
    return router.pathname === path;
  };

  const pageContext = (() => {
    const tab = String((router.query as any)?.tab || "").trim().toLowerCase();
    if (tab === "leads") return "leads_page";
    if (tab === "conversations") return "inbox";
    if (tab === "numbers") return "numbers";
    if (tab === "settings") return "settings";
    if (tab === "calendar") return "calendar";
    if (router.pathname.includes("facebook")) return "facebook_ads";
    return "dashboard";
  })();

  return (
    <div className="flex min-h-screen text-white">
      {/* Incoming Call Banner overlay (fixed; safe anywhere) */}

      <div className="w-60 p-4 bg-[#0f172a] flex flex-col justify-between border-r border-[#1e293b]">
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
            <h1 className="text-xl font-bold text-white">Cove CRM</h1>
          </div>
          <nav className="space-y-1">
            {links.map((link) => (
              <a
                key={link.name}
                href={link.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: isActivePath(link.path) ? "#f1f5f9" : "#cbd5e1",
                  textDecoration: "none",
                  transition: "background 0.15s",
                  borderLeft: isActivePath(link.path) ? "2px solid #2563eb" : "2px solid transparent",
                  paddingLeft: isActivePath(link.path) ? 10 : 12,
                  background: isActivePath(link.path) ? "#1a2535" : "transparent",
                }}
                onMouseEnter={(e) => { if (!isActivePath(link.path)) e.currentTarget.style.background = "#1e2d45"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isActivePath(link.path) ? "#1a2535" : "transparent"; }}
              >
                <span style={{ fontSize: 15, width: 20, textAlign: "center", flexShrink: 0 }}>
                  {NAV_ICONS[link.name] || "•"}
                </span>
                <span>{link.name}</span>
                {link.name === "Conversations" && unreadCount > 0 && badge(unreadCount)}
              </a>
            ))}
          </nav>
        </div>
        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="w-full rounded-xl border border-white/10 bg-gradient-to-r from-[#7c3aed] to-[#6366f1] px-4 py-3 text-left text-sm font-semibold text-white shadow-lg transition hover:opacity-95"
          >
            <div className="flex items-start gap-3">
              <span className="text-base leading-none">✨</span>
              <div className="min-w-0">
                <div>Ask Assistant</div>
                <div className="mt-0.5 text-xs font-medium text-white/75">
                  AI help, support, and answers
                </div>
              </div>
            </div>
          </button>

          <div className="pt-4 border-t border-white/5">
            <button
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="block px-1 text-left text-sm text-red-400 transition hover:text-red-300"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>

      <main
        className="flex-1 overflow-y-auto flex flex-col"
        style={{ backgroundColor: "#1e293b", color: "#ffffff" }}
      >
        <div className="px-6 py-8 flex-1">
          {children}
        </div>
      </main>

      <SupportChatModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        pageContext={pageContext}
      />
    </div>
  );
}
