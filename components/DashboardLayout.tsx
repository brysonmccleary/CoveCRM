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
import {
  FaBullhorn,
  FaCalendarAlt,
  FaChevronDown,
  FaChevronRight,
  FaCog,
  FaComments,
  FaFolderOpen,
  FaHome,
  FaPhoneAlt,
  FaRobot,
  FaSignOutAlt,
  FaChartLine,
  FaUsers,
} from "react-icons/fa";
import { HiOutlineSparkles } from "react-icons/hi2";
import type { IconType } from "react-icons";

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
  const [adminOpen, setAdminOpen] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const isAdmin = session?.user?.email?.toLowerCase() === ADMIN_EMAIL;

  type NavItem = { name: string; path: string; icon: IconType };
  const navGroups: { label: string; items: NavItem[] }[] = [
    {
      label: "CRM",
      items: [
        { name: "Home", path: "/dashboard?tab=home", icon: FaHome },
        { name: "Folders", path: "/dashboard?tab=leads", icon: FaFolderOpen },
        { name: "Calendar", path: "/dashboard?tab=calendar", icon: FaCalendarAlt },
      ],
    },
    {
      label: "Communication",
      items: [
        { name: "Conversations", path: "/dashboard?tab=conversations", icon: FaComments },
        { name: "Drip Campaigns", path: "/dashboard?tab=drip-campaigns", icon: HiOutlineSparkles },
        { name: "Numbers", path: "/dashboard?tab=numbers", icon: FaPhoneAlt },
      ],
    },
    {
      label: "Workspace",
      items: [
        ...(isAdmin ? [{ name: "FB Leads", path: "/facebook-leads", icon: FaBullhorn }] : []),
        { name: "Team", path: "/team", icon: FaUsers },
        { name: "Settings", path: "/dashboard?tab=settings", icon: FaCog },
      ],
    },
  ];

  const adminLinks: NavItem[] = isAdmin
    ? [
        { name: "Recruiting", path: "/recruiting", icon: FaUsers },
        { name: "Social Insights", path: "/recruiting/insights", icon: FaChartLine },
        { name: "AI Copilot", path: "/admin/ai-copilot", icon: FaRobot },
        { name: "Site Intelligence", path: "/admin/site-intelligence", icon: FaBullhorn },
      ]
    : [];

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

  useEffect(() => {
    if (adminLinks.some((link) => isActivePath(link.path))) setAdminOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.asPath]);

  const renderNavLink = (link: NavItem) => {
    const active = isActivePath(link.path);
    const Icon = link.icon;
    return (
      <Link
        key={link.name}
        href={link.path}
        title={link.name}
        aria-current={active ? "page" : undefined}
        className={`group relative flex min-h-10 items-center justify-center gap-3 rounded-lg border-l-2 px-3 text-sm font-semibold transition lg:justify-start ${
          active
            ? "border-blue-600 bg-[#1a2535] text-slate-100"
            : "border-transparent text-slate-400 hover:bg-[#1e2d45] hover:text-slate-100"
        }`}
      >
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="hidden min-w-0 flex-1 truncate lg:block">{link.name}</span>
        {link.name === "Conversations" && unreadCount > 0 && (
          <span
            className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white lg:static lg:text-xs"
            aria-label={`${unreadCount} unread conversations`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen text-white">
      {/* Incoming Call Banner overlay (fixed; safe anywhere) */}

      <aside className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col justify-between overflow-y-auto border-r border-[#1e293b] bg-[#0f172a] px-2 py-4 lg:w-[240px] lg:p-4">
        <div>
          <div className="mb-6 flex items-center justify-center gap-2 lg:justify-start">
            <Image
              src="/logo.png"
              alt="Cove CRM Logo"
              width={32}
              height={32}
              className="rounded"
              priority
            />
            <h1 className="hidden text-xl font-bold text-white lg:block">Cove CRM</h1>
          </div>
          <nav className="space-y-4" aria-label="Main navigation">
            {navGroups.map((group) => (
              <div key={group.label}>
                <div className="mb-1 hidden px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 lg:block">
                  {group.label}
                </div>
                <div className="space-y-1">{group.items.map(renderNavLink)}</div>
              </div>
            ))}

            {adminLinks.length > 0 && (
              <div className="border-t border-white/5 pt-3">
                <button
                  type="button"
                  onClick={() => setAdminOpen((open) => !open)}
                  className="flex min-h-10 w-full items-center justify-center gap-3 rounded-lg px-3 text-sm font-semibold text-slate-400 transition hover:bg-[#1e2d45] hover:text-slate-100 lg:justify-start"
                  aria-expanded={adminOpen}
                >
                  <FaCog aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="hidden flex-1 text-left lg:block">Admin</span>
                  <span className="hidden lg:block">{adminOpen ? <FaChevronDown /> : <FaChevronRight />}</span>
                </button>
                {adminOpen && <div className="mt-1 space-y-1 lg:pl-2">{adminLinks.map(renderNavLink)}</div>}
              </div>
            )}
          </nav>
        </div>
        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex h-10 w-full items-center justify-center rounded-xl border border-white/10 bg-gradient-to-r from-[#7c3aed] to-[#6366f1] px-2 text-sm font-semibold text-white shadow-lg transition hover:opacity-95 lg:h-auto lg:justify-start lg:px-4 lg:py-3 lg:text-left"
            aria-label="Ask Assistant"
          >
            <div className="flex items-start gap-3">
              <HiOutlineSparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="hidden min-w-0 lg:block">
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
              <span className="hidden lg:inline">Log Out</span>
              <FaSignOutAlt className="h-4 w-4 lg:hidden" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <main
        className="flex-1 overflow-y-auto flex flex-col"
        style={{ backgroundColor: "#1e293b", color: "#ffffff" }}
      >
        <div className="flex-1 px-3 py-5 sm:px-5 lg:px-6 lg:py-8">
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
