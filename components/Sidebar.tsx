import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import Image from "next/image";

export default function Sidebar() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const res = await fetch("/api/conversations/unread-count");
        const data = await res.json();
        if (res.ok && typeof data.count === "number") {
          setUnreadCount(data.count);
        }
      } catch (err) {
        console.error("Failed to fetch unread count", err);
      }
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 15000);
    return () => clearInterval(interval);
  }, []);

  const badge = (count: number) =>
    count > 0 && (
      <span className="ml-2 inline-flex items-center justify-center text-xs font-bold bg-red-600 text-white rounded-full px-2 py-0.5">
        {count > 99 ? "99+" : count}
      </span>
    );

  return (
    <div className="bg-[#0f172a] text-white w-60 p-4 min-h-screen flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 mb-6">
          {/* ✅ Logo */}
          <Image
            src="/logo.png"
            alt="CRM Cove Logo"
            width={32}
            height={32}
            className="rounded"
            priority
          />
          <h1 className="text-xl font-bold">CRM Cove</h1>
        </div>

        <nav className="space-y-2">
          <Link href="/dashboard?tab=home" className="block hover:underline">Home</Link>
          <Link href="/dashboard?tab=leads" className="block hover:underline">Leads</Link>
          <Link href="/dashboard?tab=drip-campaigns" className="block hover:underline">Drip Campaigns</Link>

          <Link href="/dashboard?tab=conversations" className="block hover:underline flex items-center">
            Conversations {badge(unreadCount)}
          </Link>

          <Link href="/dashboard?tab=calendar" className="block hover:underline">Calendar</Link>
          <Link href="/dashboard?tab=numbers" className="block hover:underline">Numbers</Link>
          <Link href="/dashboard?tab=settings" className="block hover:underline">Settings</Link>
        </nav>
      </div>

      <div className="mt-8">
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="block text-red-500 hover:underline"
        >
          Log Out
        </button>
      </div>
    </div>
  );
}
