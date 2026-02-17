import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import Image from "next/image";
import { connectAndJoin } from "@/lib/socketClient";

export default function Sidebar() {
  const { data: session } = useSession();
  const [unreadCount, setUnreadCount] = useState(0);
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
          <Link href="/dashboard?tab=home" className="block hover:underline">
            Home
          </Link>
          <Link href="/dashboard?tab=leads" className="block hover:underline">
            Leads
          </Link>
          <Link
            href="/dashboard?tab=drip-campaigns"
            className="block hover:underline"
          >
            Drip Campaigns
          </Link>

          <Link
            href="/dashboard?tab=conversations"
            className="block hover:underline flex items-center"
          >
            Conversations {badge(unreadCount)}
          </Link>

          <Link href="/dashboard?tab=calendar" className="block hover:underline">
            Calendar
          </Link>
          <Link href="/dashboard?tab=numbers" className="block hover:underline">
            Numbers
          </Link>
          <Link href="/dashboard?tab=settings" className="block hover:underline">
            Settings
          </Link>
        </nav>
      </div>

      <div className="mt-8">
        <button
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className="block text-red-500 hover:underline"
          aria-label="Log out and return to Home"
        >
          Log Out
        </button>
      </div>
    </div>
  );
}
