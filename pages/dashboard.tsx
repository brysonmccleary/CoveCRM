// /pages/dashboard.tsx
import { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import RequireAuth from "@/lib/requireAuth";
import DashboardLayout from "@/components/DashboardLayout";
import DripCampaignsPanel from "@/components/DripCampaignsPanel";
import LeadsPanel from "@/components/LeadsPanel";
import BuyNumberPanel from "@/components/BuyNumberPanel";
import CalendarBookings from "@/components/CalendarBookings";
import BookingForm from "@/components/BookingForm";
import SettingsPanel from "@/components/SettingsPanel";
import MessagesPanel from "@/components/messages/MessagesPanel";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";
import { FaPhoneAlt } from "react-icons/fa";

type KPI = { dials: number; connects: number; totalTalkSec: number; avgTalkSec: number; longestTalkSec: number; contactRate: number };
type TrendPoint = { label: string; dials: number; connects: number; date?: string; hour?: string };
type ApiResponse = {
  range: { from: string; to: string; timezone: string };
  kpis: KPI;
  trends: { daily7: TrendPoint[]; daily30: TrendPoint[] };
};

const NumbersPanel = () => (
  <div className="p-4 space-y-6">
    <h1 className="text-2xl font-bold">Manage Numbers</h1>
    <BuyNumberPanel />
  </div>
);

const CalendarPanel = ({ showBanner }: { showBanner: boolean }) => (
  <div className="p-4 space-y-8">
    {showBanner && (
      <div className="bg-yellow-100 text-yellow-800 p-4 mb-4 rounded-md">
        ⏰ You haven’t connected your Google Calendar yet.{" "}
        <a href="/api/connect/google-calendar" className="underline font-semibold">
          Connect Now
        </a>
      </div>
    )}
    <div>
      <h1 className="text-2xl font-bold mb-4">Upcoming Bookings</h1>
      <CalendarBookings />
    </div>
    <div>
      <h2 className="text-xl font-semibold mb-2">Book a New Appointment</h2>
      <BookingForm />
    </div>
  </div>
);

function secsToHMS(s: number) {
  const sec = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function DashboardOverview() {
  // Removed "thisWeek"; only Today / Last 7 / Last 30
  const [range, setRange] = useState<"today" | "last7" | "last30">("last30");
  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResponse | null>(null);

  const fetchStats = async (r: typeof range) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/stats?range=${encodeURIComponent(r)}&tz=America/Phoenix`);
      const json: any = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || "Failed to load stats");
      setResp(json);
    } catch (e: any) {
      toast.error(e?.message || "Error fetching dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const k = resp?.kpis;
  const dailySeries = range === "last30" ? (resp as any)?.trends?.daily30 || [] : (resp as any)?.trends?.daily7 || [];

  const kpiCards = [
    { label: "Dials", value: k?.dials ?? 0 },
    { label: "Connects", value: k?.connects ?? 0 },
    { label: "Talk Time", value: k ? secsToHMS(k.totalTalkSec) : "0s" },
    { label: "Contact Rate", value: k ? `${Math.round((k.contactRate || 0) * 100)}%` : "0%" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Range picker */}
      <div className="flex flex-wrap items-center gap-2">
        {(["today", "last7", "last30"] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setRange(opt)}
            className={`px-3 py-1 rounded border ${range === opt ? "bg-[#111D35] text-white border-[#111D35]" : "bg-white text-gray-800 border-gray-300"} transition`}
          >
            {opt === "last7" ? "Last 7" : opt === "last30" ? "Last 30" : "Today"}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((c) => (
          <div key={c.label} className="bg-[#111D35] text-white rounded-lg p-4 shadow flex flex-col items-center justify-center">
            <div className="text-sm uppercase text-gray-400">{c.label}</div>
            <div className="text-2xl font-bold">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Main performance chart */}
      <div className="bg-[#111D35] text-white p-6 rounded-lg shadow">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FaPhoneAlt className="text-pink-400" />
          {`Call Performance — ${range === "today" ? "Today" : range === "last30" ? "Last 30 Days" : "Last 7 Days"}`}
        </h2>
        <div className="h-80">
          {loading ? (
            <p className="text-gray-400">Loading chart...</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#D1D5DB" />
                <YAxis stroke="#D1D5DB" allowDecimals={false} />
                <Tooltip formatter={(value: number) => `${value} calls`} labelStyle={{ color: "#E5E7EB" }} contentStyle={{ backgroundColor: "#1A2B45", borderColor: "#4B5563" }} />
                <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: "#E5E7EB" }} />
                <Line type="monotone" dataKey="dials" stroke="#3B82F6" strokeWidth={3} dot={{ r: 3 }} name="Dials" />
                <Line type="monotone" dataKey="connects" stroke="#F97316" strokeWidth={3} dot={{ r: 3 }} name="Connects" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage({ userNeedsCalendarConnect }: { userNeedsCalendarConnect?: boolean }) {
  const { data: session } = useSession();
  const router = useRouter();
  const { tab } = router.query;

  useEffect(() => { void session; }, [session]);

  return (
    <RequireAuth>
      <DashboardLayout>
        {!tab || tab === "home" ? <DashboardOverview /> : null}
        {tab === "leads" && <LeadsPanel />}
        {tab === "conversations" && <MessagesPanel />}
        {tab === "numbers" && <NumbersPanel />}
        {tab === "settings" && <SettingsPanel />}
        {tab === "drip-campaigns" && <DripCampaignsPanel />}
        {tab === "calendar" && <CalendarPanel showBanner={!!userNeedsCalendarConnect} />}
      </DashboardLayout>
    </RequireAuth>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session || !session.user?.email) {
    return { redirect: { destination: "/auth/signin", permanent: false } };
  }
  await dbConnect();
  const user = await User.findOne({ email: session.user.email as string });
  const hasCalendarConnected = Boolean(user?.googleSheets?.accessToken && user?.calendarId);
  return { props: { userNeedsCalendarConnect: !hasCalendarConnected } };
};
