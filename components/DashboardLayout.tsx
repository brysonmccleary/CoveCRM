import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import Image from "next/image";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const socketRef = useRef<any>(null);

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
      if (res.ok && typeof data.count === "number") {
        setUnreadCount(data.count);
      }
    } catch (err) {
      console.error("Unread fetch error:", err);
    }
  };

  useEffect(() => {
    // initial fetch + polling
    fetchUnread();
    intervalRef.current = setInterval(fetchUnread, 15000);

    // socket live updates
    (async () => {
      try {
        const { io } = await import("socket.io-client");
        const s = io({ path: "/api/socket/" });
        socketRef.current = s;

        const refetch = () => fetchUnread();
        s.on("connect", refetch);
        s.on("message:new", refetch);
        s.on("message:read", refetch);
        s.on("conversation:updated", refetch);
      } catch (e) {
        console.warn("socket setup failed (layout), polling only", e);
      }
    })();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (socketRef.current) {
        try {
          socketRef.current.off("message:new");
          socketRef.current.off("message:read");
          socketRef.current.off("conversation:updated");
          socketRef.current.disconnect();
        } catch {}
      }
    };
  }, []);

  const badge = (count: number) =>
    count > 0 && (
      <span className="ml-2 text-xs font-bold bg-red-600 text-white rounded-full px-2 py-0.5">
        {count > 99 ? "99+" : count}
      </span>
    );

  return (
    <div className="flex min-h-screen text-white">
      <div className="w-60 p-4 bg-[#0f172a] flex flex-col justify-between border-r border-[#1e293b]">
        <div>
          {/* Logo and title row */}
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
