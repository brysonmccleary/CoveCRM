import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import Image from "next/image";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const callbackUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  const links = [
    { name: "Home", path: "/dashboard?tab=home" },
    { name: "Leads", path: "/dashboard?tab=leads" },
    { name: "Drip Campaigns", path: "/dashboard?tab=drip-campaigns" },
    { name: "Conversations", path: "/dashboard?tab=conversations" },
    { name: "Calendar", path: "/dashboard?tab=calendar" },
    { name: "Numbers", path: "/dashboard?tab=numbers" },
    { name: "Settings", path: "/dashboard?tab=settings" },
  ];

  useEffect(() => {
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

    fetchUnread();
    const interval = setInterval(fetchUnread, 15000);
    return () => clearInterval(interval);
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
          {/* ✅ Logo and title row */}
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
            onClick={() => signOut({ callbackUrl })}
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
