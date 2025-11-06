// components/DashboardLayout.tsx
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { connectAndJoin } from "@/lib/socketClient";
import IncomingCallBanner from "@/components/IncomingCallBanner"; // ← NEW

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const links = [
    { name: "Home", path: "/dashboard?tab=home" },
    { name: "Leads", path: "/dashboard?tab=leads" },
    { name: "Drip Campaigns", path: "/dashboard?tab=drip-campaigns" },
    { name: "Conversations", path: "/dashboard?tab=conversations" },
    { name: "Calendar", path: "/dashboard?tab=calendar" },
    { name: "Numbers", path: "/dashboard?tab=numbers" },
    { name: "Settings", path: "/dashboard?tab=settings" },
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
      <span className="ml-2 text-xs font-bold bg-red-600 text-white rounded-full px-2 py-0.5">
        {count > 99 ? "99+" : count}
      </span>
    );

  return (
    <div className="flex min-h-screen text-white">
      {/* Incoming Call Banner overlay (fixed; safe anywhere) */}
      <IncomingCallBanner />

      <div className="w-60 p-4 bg-[#0f172a] flex flex-col justify-between border-r border-[#1e293b]">
        <div>
          <div className="flex items-center gap-2 mb-6">
            <Image
              src="/logo.png"
              alt="CRM Cove Logo"
              width={32}
              height={32}
              className="rounded"
              priority
            />
            <h1 className="text-xl font-bold text-white">CRM Cove</h1>
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
        <div className="mt-8">
          <button
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            className="block text-red-400 hover:underline"
          >
            Log Out
          </button>
        </div>
      </div>

      <main
        className="flex-1 px-6 py-8 overflow-y-auto"
        style={{ backgroundColor: "#1e293b", color: "#ffffff" }}
      >
        {children}
      </main>
    </div>
  );
}
