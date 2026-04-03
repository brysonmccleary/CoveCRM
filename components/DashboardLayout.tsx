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
    { name: "Team", path: "/team" },
    { name: "Settings", path: "/dashboard?tab=settings" },
    ...(isAdmin ? [
      { name: "FB Leads", path: "/facebook-leads" },
      { name: "Recruiting", path: "/recruiting" },
      { name: "Admin: Prospecting", path: "/admin/prospecting" },
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
          <nav className="space-y-2">
            {links.map((link) => (
              <a
                key={link.name}
                href={link.path}
                className="block text-white hover:bg-[#1e293b] px-3 py-2 rounded transition flex items-center"
              >
                {link.name}
                {link.name === "Conversations" && badge(unreadCount)}
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
        {/* Smart follow-up nudge banners */}
        {nudges.length > 0 && (
          <div className="px-6 pt-4 space-y-2">
            {nudges.slice(0, 2).map((nudge) => (
              <div
                key={nudge._id}
                className={`flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm ${
                  nudge.priority === "high"
                    ? "bg-red-900/40 border border-red-700 text-red-200"
                    : nudge.priority === "medium"
                    ? "bg-amber-900/40 border border-amber-700 text-amber-200"
                    : "bg-blue-900/30 border border-blue-800 text-blue-200"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span>{nudge.priority === "high" ? "🔥" : nudge.priority === "medium" ? "⏰" : "💡"}</span>
                  <div>
                    <span className="font-semibold">{nudge.leadName}: </span>
                    <span>{nudge.message}</span>
                    <Link
                      href={`/lead/${nudge.leadId}`}
                      className="ml-2 underline opacity-80 hover:opacity-100"
                    >
                      View lead →
                    </Link>
                  </div>
                </div>
                <button
                  onClick={() => dismissNudge(nudge._id)}
                  className="opacity-60 hover:opacity-100 flex-shrink-0 text-lg leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

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
