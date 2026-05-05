// /pages/dashboard.tsx
import { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { isAccountActivated } from "@/lib/billing/requireActivatedAccount";

import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import Link from "next/link";
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
import {
  FaCalendarCheck,
  FaChartLine,
  FaPhoneAlt,
  FaRobot,
  FaShieldAlt,
  FaSms,
} from "react-icons/fa";

type KPI = {
  dials: number;
  connects: number;
  totalTalkSec: number;
  avgTalkSec: number;
  longestTalkSec: number;
  contactRate: number;
};

type TrendPoint = {
  label: string;
  dials: number;
  connects: number;
  date?: string;
  hour?: string;
};

type ApiResponse = {
  range: { from: string; to: string; timezone: string };
  kpis: KPI;
  dispositions?: {
    sold: number;
    booked: number;
    notInterested: number;
    noAnswer: number;
  };
  trends: { daily7: TrendPoint[]; daily30: TrendPoint[] };
};

type MoneyStats = {
  spend: number;
  leads: number;
  booked: number;
  sold: number;
  revenue: number;
  cpl: number;
  roas: number;
  costPerSale: number;
};

type AIActivity = {
  id: string;
  type: "call" | "text" | "booking" | "session" | "safety" | "ad";
  title: string;
  detail: string;
  at: string;
  leadId?: string;
  campaignId?: string;
  status?: string;
};

type AIActivityResponse = {
  activities: AIActivity[];
  summary: {
    aiActionsToday: number;
    bookedToday: number;
    pendingRecommendations?: number;
  };
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
        <a
          href="/api/connect/google-calendar"
          className="underline font-semibold"
        >
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

function formatCurrency(value: number) {
  return `$${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: value > 0 && value < 100 ? 2 : 0,
  })}`;
}

function secsToHMS(s: number) {
  const sec = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

function formatPercent(value: number) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AIActivityCard({
  activities,
  summary,
}: {
  activities: AIActivity[];
  summary?: AIActivityResponse["summary"];
}) {
  const [expanded, setExpanded] = useState(false);
  const aiActionsToday = summary?.aiActionsToday ?? 0;
  const bookedToday = summary?.bookedToday ?? 0;
  const pendingRecommendations = summary?.pendingRecommendations ?? 0;

  return (
    <div className="bg-[#111D35] text-white p-5 rounded-lg shadow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI Activity</h2>
          <p className="text-sm text-gray-400">High-value AI work only.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-blue-300 hover:text-blue-200"
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
          <Link href="/dashboard?tab=settings" className="text-blue-300 hover:text-blue-200">
            AI settings
          </Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "AI actions today", value: aiActionsToday },
          { label: "Booked by AI", value: bookedToday },
          { label: "Pending recommendations", value: pendingRecommendations },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="text-xs uppercase text-gray-400">{item.label}</div>
            <div className="text-2xl font-bold">{item.value}</div>
          </div>
        ))}
      </div>

      {expanded && (
        activities.length === 0 ? (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
            No high-value AI activity yet.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
          {activities.slice(0, 8).map((activity) => {
            const Icon =
              activity.type === "call"
                ? FaPhoneAlt
                : activity.type === "text"
                ? FaSms
                : activity.type === "booking"
                ? FaCalendarCheck
                : activity.type === "session"
                ? FaRobot
                : activity.type === "safety"
                ? FaShieldAlt
                : FaChartLine;

            return (
              <div
                key={activity.id}
                className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3"
              >
                <Icon className="mt-1 h-4 w-4 shrink-0 text-blue-300" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-white">{activity.title}</p>
                    <span className="text-xs text-gray-400">{formatActivityTime(activity.at)}</span>
                  </div>
                  {activity.detail && (
                    <p className="mt-1 truncate text-sm text-gray-400">{activity.detail}</p>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        )
      )}
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  facebook_realtime: "Facebook (Live)",
  doi_prospecting: "DOI Prospecting",
  google_sheet: "Google Sheet",
  csv_import: "CSV Import",
  manual: "Manual Entry",
};

function LeadSourceROIWidget() {
  const [bySource, setBySource] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leads/source-stats")
      .then((r) => r.json())
      .then((d) => setBySource(d.bySource || {}))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sources = Object.keys(bySource);
  if (loading) return null;
  if (sources.length === 0) return null;

  return (
    <div className="bg-[#0f172a] rounded-xl p-5 mt-4">
      <h3 className="text-white font-semibold mb-3">Lead Sources (Last 3 Months)</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-left border-b border-white/10">
              <th className="pb-2">Source</th>
              <th className="pb-2 text-right">Leads</th>
              <th className="pb-2 text-right">Contacted</th>
              <th className="pb-2 text-right">Booked</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((src) => {
              const s = bySource[src];
              const contactRate = s.leadCount > 0 ? Math.round((s.contactedCount / s.leadCount) * 100) : 0;
              return (
                <tr key={src} className="border-b border-white/5">
                  <td className="py-2 text-white">{SOURCE_LABELS[src] || src}</td>
                  <td className="py-2 text-right text-gray-300">{s.leadCount}</td>
                  <td className="py-2 text-right text-yellow-300">{s.contactedCount} ({contactRate}%)</td>
                  <td className="py-2 text-right text-green-300">{s.bookedCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DashboardOverview() {
  const [view, setView] = useState<"dial" | "ai">("dial");
  const [range, setRange] = useState<"today" | "last7" | "last30">("last30");
  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [moneyStats, setMoneyStats] = useState<MoneyStats | null>(null);
  const [aiActivity, setAiActivity] = useState<AIActivityResponse | null>(null);

  const fetchStats = async (r: typeof range) => {
    setLoading(true);
    try {
      const [statsRes, moneyRes, activityRes] = await Promise.all([
        fetch(
          `/api/dashboard/stats?range=${encodeURIComponent(
            r,
          )}&tz=America/Phoenix`,
        ),
        fetch("/api/facebook/stats"),
        fetch("/api/ai/activity-feed?limit=20"),
      ]);

      const json: any = await statsRes.json();
      if (!statsRes.ok || json?.error)
        throw new Error(json?.error || "Failed to load stats");
      setResp(json);

      if (moneyRes.ok) {
        setMoneyStats(await moneyRes.json());
      }

      if (activityRes.ok) {
        setAiActivity(await activityRes.json());
      }
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
  const dailySeries =
    range === "last30"
      ? (resp as any)?.trends?.daily30 || []
      : (resp as any)?.trends?.daily7 || [];

  const bookedAppointments = Math.max(
    resp?.dispositions?.booked || 0,
    moneyStats?.booked || 0,
    aiActivity?.summary?.bookedToday || 0,
  );

  const dialCards = [
    { label: "Dials", value: k?.dials ?? 0 },
    { label: "Connects", value: k?.connects ?? 0 },
    { label: "Contact Rate", value: k ? formatPercent(k.contactRate || 0) : "0%" },
    { label: "Talk Time", value: k ? secsToHMS(k.totalTalkSec) : "0s" },
  ];

  const aiCards = [
    { label: "Spend", value: formatCurrency(moneyStats?.spend || 0) },
    { label: "Leads", value: moneyStats?.leads ?? 0 },
    {
      label: "CPL",
      value: moneyStats?.cpl ? formatCurrency(moneyStats.cpl) : "—",
    },
    { label: "Booked Appointments", value: bookedAppointments },
    { label: "AI Actions Today", value: aiActivity?.summary?.aiActionsToday ?? 0 },
    { label: "Sales", value: resp?.dispositions?.sold ?? 0 },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[#24324a] p-4 shadow-lg shadow-black/20 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid w-full grid-cols-2 gap-2 rounded-xl border border-white/10 bg-[#0b1220] p-1.5 shadow-inner lg:w-[460px]">
          {[
            { id: "dial" as const, label: "Dial Overview", icon: "📞" },
            { id: "ai" as const, label: "AI Info", icon: "🤖" },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setView(option.id)}
              className={`min-h-12 rounded-lg px-4 py-3 text-sm font-bold transition sm:text-base ${
                view === option.id
                  ? "bg-[#2563eb] text-white shadow-md shadow-blue-950/40"
                  : "text-gray-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <span aria-hidden="true">{option.icon}</span>
                <span>{option.label}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {(["today", "last7", "last30"] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setRange(opt)}
            className={`px-3 py-1 rounded border ${
              range === opt
                ? "bg-[#111D35] text-white border-[#111D35]"
                : "bg-white text-gray-800 border-gray-300"
            } transition`}
          >
            {opt === "last7"
              ? "Last 7"
              : opt === "last30"
              ? "Last 30"
              : "Today"}
          </button>
          ))}
        </div>
      </div>

      {view === "dial" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {dialCards.map((c) => (
              <div
                key={c.label}
                className="bg-[#111D35] text-white rounded-lg p-4 shadow flex flex-col items-center justify-center"
              >
                <div className="text-sm uppercase text-gray-400">{c.label}</div>
                <div className="text-2xl font-bold">{c.value}</div>
              </div>
            ))}
          </div>

          <div className="bg-[#111D35] text-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FaPhoneAlt className="text-pink-400" />
              {`Call Performance — ${
                range === "today"
                  ? "Today"
                  : range === "last30"
                  ? "Last 30 Days"
                  : "Last 7 Days"
              }`}
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
                    <Tooltip
                      formatter={(value: unknown) => `${value ?? 0} calls`}
                      labelStyle={{ color: "#E5E7EB" }}
                      contentStyle={{
                        backgroundColor: "#1A2B45",
                        borderColor: "#4B5563",
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      wrapperStyle={{ color: "#E5E7EB" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="dials"
                      stroke="#3B82F6"
                      strokeWidth={3}
                      dot={{ r: 3 }}
                      name="Dials"
                    />
                    <Line
                      type="monotone"
                      dataKey="connects"
                      stroke="#F97316"
                      strokeWidth={3}
                      dot={{ r: 3 }}
                      name="Connects"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <LeadSourceROIWidget />
        </>
      )}

      {view === "ai" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {aiCards.map((c) => (
              <div
                key={c.label}
                className="bg-[#111D35] text-white rounded-lg p-4 shadow flex flex-col items-center justify-center"
              >
                <div className="text-sm uppercase text-gray-400">{c.label}</div>
                <div className="text-2xl font-bold">{c.value}</div>
              </div>
            ))}
          </div>

          <AIActivityCard
            activities={aiActivity?.activities || []}
            summary={aiActivity?.summary}
          />
        </div>
      )}
    </div>
  );
}

export default function DashboardPage({
  userNeedsCalendarConnect,
}: {
  userNeedsCalendarConnect?: boolean;
}) {
  const { data: session } = useSession();
  const router = useRouter();
  const { tab } = router.query;

  useEffect(() => {
    void session;
  }, [session]);

  return (
    <RequireAuth>
      <DashboardLayout>
        {!tab || tab === "home" ? <DashboardOverview /> : null}
        {tab === "leads" && <LeadsPanel />}
        {tab === "conversations" && <MessagesPanel />}
        {tab === "numbers" && <NumbersPanel />}
        {tab === "settings" && <SettingsPanel />}
        {tab === "drip-campaigns" && <DripCampaignsPanel />}
        {tab === "calendar" && (
          <CalendarPanel showBanner={!!userNeedsCalendarConnect} />
        )}
      </DashboardLayout>
    </RequireAuth>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session || !session.user?.email) {
    return {
      redirect: { destination: "/auth/signin", permanent: false },
    };
  }

  await dbConnect();
  const user = await User.findOne({ email: session.user.email as string });

  if (!isAccountActivated(user)) {
    const destination =
      (user as any)?.emailVerified === true
        ? `/billing?email=${encodeURIComponent(String(session.user.email))}&trial=1`
        : `/verify-email?email=${encodeURIComponent(String(session.user.email))}`;
    return {
      redirect: { destination, permanent: false },
    };
  }

  // ✅ Use the actual calendar fields, NOT googleSheets
  const hasCalendarConnected = Boolean(
    (user as any)?.googleCalendar?.accessToken || (user as any)?.calendarId,
  );

  return {
    props: {
      userNeedsCalendarConnect: !hasCalendarConnected,
    },
  };
};
