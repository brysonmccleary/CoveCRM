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

type UpcomingAppointment = {
  _id: string;
  displayName: string;
  phone: string;
  state: string | null;
  appointmentTime: string;
  folderId: string | null;
  folderName: string | null;
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

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addLocalDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatAppointmentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  if (sameLocalDay(date, now)) return `Today at ${time}`;
  if (sameLocalDay(date, addLocalDays(now, 1))) return `Tomorrow at ${time}`;

  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  return `${day} at ${time}`;
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

type ObjRange = "today" | "7days" | "30days" | "90days";
type TopObjection = { objection: string; count: number; suggestedResponse?: string };

function TopObjectionsWidget() {
  const [range, setRange] = useState<ObjRange>("7days");
  const [objections, setObjections] = useState<TopObjection[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/calls/top-objections?range=${range}`);
        const data = await res.json();
        if (!cancelled) setObjections(data.objections || []);
      } catch {
        if (!cancelled) setObjections([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [range]);

  const RANGE_LABELS: { value: ObjRange; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "7days", label: "7 Days" },
    { value: "30days", label: "30 Days" },
  ];

  const maxCount = objections.length > 0 ? Math.max(...objections.map(o => o.count)) : 1;

  const RANK_COLORS = [
    { bar: "#fcd34d", text: "#fcd34d", bg: "rgba(234,179,8,0.07)", border: "rgba(234,179,8,0.2)" },
    { bar: "#94a3b8", text: "#94a3b8", bg: "rgba(156,163,175,0.07)", border: "rgba(156,163,175,0.18)" },
    { bar: "#f97316", text: "#f97316", bg: "rgba(180,83,9,0.08)", border: "rgba(180,83,9,0.22)" },
  ];

  return (
    <div style={{ background: "#111D35", border: "1px solid #1e2d45", borderRadius: 10, padding: "20px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#E5E7EB", display: "flex", alignItems: "center", gap: 6 }}>
          🚧 Top Objections
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {RANGE_LABELS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setRange(value)}
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "4px 11px",
                borderRadius: 20,
                border: "none",
                cursor: "pointer",
                background: range === value ? "#2563eb" : "rgba(255,255,255,0.07)",
                color: range === value ? "#fff" : "#6B7280",
                transition: "all 0.15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p style={{ color: "#94a3b8", fontSize: 13 }}>Loading…</p>
      ) : objections.length === 0 ? (
        <p style={{ color: "#374151", fontSize: 13 }}>
          No objection data yet. Generate call overviews to track objections.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {objections.map((obj, idx) => {
            const colors = RANK_COLORS[idx] || { bar: "#6b7280", text: "#94a3b8", bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.1)" };
            const pct = Math.round((obj.count / maxCount) * 100);
            return (
              <div key={idx}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 16px",
                    borderRadius: 8,
                    border: `1px solid ${colors.border}`,
                    background: colors.bg,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, width: 26, textAlign: "center", color: colors.text, flexShrink: 0 }}>
                    #{idx + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#F3F4F6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {obj.objection}
                    </div>
                    <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>
                      {obj.count} time{obj.count !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={{ width: 90, flexShrink: 0 }}>
                    <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2 }}>
                      <div style={{ height: 4, borderRadius: 2, background: colors.bar, width: `${pct}%` }} />
                    </div>
                  </div>
                  {obj.suggestedResponse && (
                    <button
                      onClick={() => setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                      style={{
                        fontSize: 11,
                        color: "#60a5fa",
                        background: "rgba(96,165,250,0.1)",
                        border: "1px solid rgba(96,165,250,0.2)",
                        padding: "5px 12px",
                        borderRadius: 6,
                        cursor: "pointer",
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {expanded[idx] ? "Hide" : "View Response"}
                    </button>
                  )}
                </div>
                {expanded[idx] && obj.suggestedResponse && (
                  <div
                    style={{
                      marginTop: 4,
                      background: "rgba(96,165,250,0.08)",
                      border: "1px solid rgba(96,165,250,0.2)",
                      borderRadius: 7,
                      padding: "10px 14px",
                    }}
                  >
                    <p style={{ fontSize: 11, color: "#60a5fa", fontWeight: 600, marginBottom: 4 }}>Suggested Response</p>
                    <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{obj.suggestedResponse}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
    <div style={{ background: "#0d1520", borderRadius: 10, padding: "18px 22px", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#E5E7EB", marginBottom: 14 }}>Lead Sources — Last 3 Months</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              <th style={{ color: "#6B7280", fontWeight: 500, paddingBottom: 9, textAlign: "left" }}>Source</th>
              <th style={{ color: "#6B7280", fontWeight: 500, paddingBottom: 9, textAlign: "right" }}>Leads</th>
              <th style={{ color: "#6B7280", fontWeight: 500, paddingBottom: 9, textAlign: "right" }}>Contacted</th>
              <th style={{ color: "#6B7280", fontWeight: 500, paddingBottom: 9, textAlign: "right" }}>Booked</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((src) => {
              const s = bySource[src];
              const contactRate = s.leadCount > 0 ? Math.round((s.contactedCount / s.leadCount) * 100) : 0;
              return (
                <tr key={src} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "9px 0", color: "#D1D5DB" }}>{SOURCE_LABELS[src] || src}</td>
                  <td style={{ padding: "9px 0", textAlign: "right", color: "#D1D5DB" }}>{s.leadCount}</td>
                  <td style={{ padding: "9px 0", textAlign: "right", color: "#fcd34d" }}>{s.contactedCount} ({contactRate}%)</td>
                  <td style={{ padding: "9px 0", textAlign: "right", color: "#34d399" }}>{s.bookedCount}</td>
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
  const router = useRouter();
  const [view, setView] = useState<"dial" | "ai">("dial");
  const [range, setRange] = useState<"today" | "last7" | "last30">("last30");
  const [loading, setLoading] = useState(true);
  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [moneyStats, setMoneyStats] = useState<MoneyStats | null>(null);
  const [aiActivity, setAiActivity] = useState<AIActivityResponse | null>(null);
  const [appointments, setAppointments] = useState<UpcomingAppointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; dials: number; connects: number; label: string } | null>(null);

  const fetchStats = async (r: typeof range) => {
    setLoading(true);
    try {
      const [statsRes, moneyRes, activityRes] = await Promise.all([
        fetch(`/api/dashboard/stats?range=${encodeURIComponent(r)}&tz=America/Phoenix`),
        fetch("/api/facebook/stats"),
        fetch("/api/ai/activity-feed?limit=20"),
      ]);
      const json: any = await statsRes.json();
      if (!statsRes.ok || json?.error) throw new Error(json?.error || "Failed to load stats");
      setResp(json);
      if (moneyRes.ok) setMoneyStats(await moneyRes.json());
      if (activityRes.ok) setAiActivity(await activityRes.json());
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

  useEffect(() => {
    let cancelled = false;
    const loadAppointments = async () => {
      setAppointmentsLoading(true);
      try {
        const res = await fetch("/api/dashboard/upcoming-appointments", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setAppointments(Array.isArray(data?.appointments) ? data.appointments : []);
      } catch {
        if (!cancelled) setAppointments([]);
      } finally {
        if (!cancelled) setAppointmentsLoading(false);
      }
    };
    loadAppointments();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const removeExpiredAppointments = () => {
      const now = new Date();
      setAppointments((prev) =>
        prev.filter((appointment) => new Date(appointment.appointmentTime) >= now),
      );
    };

    removeExpiredAppointments();
    const interval = window.setInterval(removeExpiredAppointments, 45000);
    return () => window.clearInterval(interval);
  }, []);

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
    { label: "CPL", value: moneyStats?.cpl ? formatCurrency(moneyStats.cpl) : "—" },
    { label: "Booked Appointments", value: bookedAppointments },
    { label: "AI Actions Today", value: aiActivity?.summary?.aiActionsToday ?? 0 },
    { label: "Sales", value: resp?.dispositions?.sold ?? 0 },
  ];

  const maxDials = dailySeries.length > 0 ? Math.max(...dailySeries.map((d: any) => d.dials || 0), 1) : 1;
  const chartHeight = 220;

  const openLead = (leadId: string) => {
    window.location.href = `/dial/${encodeURIComponent(leadId)}`;
  };

  const callLead = (leadId: string) => {
    window.location.href = `/dial-session?leadId=${encodeURIComponent(leadId)}`;
  };

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, background: "#0b1220", minHeight: "100vh" }}>

      {/* ── TOP BAR ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#24324a",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 10,
        padding: "10px 14px",
        gap: 12,
      }}>
        <div style={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 4, display: "flex", gap: 3 }}>
          {([{ id: "dial" as const, label: "📞 Dial Overview" }]).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setView(option.id)}
              style={{
                padding: "7px 18px",
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: view === option.id ? "#2563eb" : "transparent",
                color: view === option.id ? "#fff" : "#9CA3AF",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 5 }}>
          {(["today", "last7", "last30"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setRange(opt)}
              style={{
                padding: "5px 13px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: range === opt ? 600 : 500,
                border: "1px solid",
                borderColor: range === opt ? "transparent" : "#374151",
                cursor: "pointer",
                background: range === opt ? "#2563eb" : "rgba(255,255,255,0.05)",
                color: range === opt ? "#fff" : "#9CA3AF",
                transition: "all 0.15s",
              }}
            >
              {opt === "last7" ? "Last 7" : opt === "last30" ? "Last 30" : "Today"}
            </button>
          ))}
        </div>
      </div>

      {view === "dial" && (
        <>
          {/* ── KPI CARDS ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {dialCards.map((c) => (
              <div
                key={c.label}
                style={{
                  background: "#111D35",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6B7280" }}>
                  {c.label}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#F9FAFB", lineHeight: 1 }}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>

          {/* ── CALL PERFORMANCE CHART — full width ── */}
          <div style={{ background: "#111D35", borderRadius: 10, padding: "20px 22px", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#E5E7EB", display: "flex", alignItems: "center", gap: 7 }}>
                <FaPhoneAlt style={{ color: "#F472B6", fontSize: 12 }} />
                {`Call Performance — ${range === "today" ? "Today" : range === "last30" ? "Last 30 Days" : "Last 7 Days"}`}
              </div>
              <div style={{ display: "flex", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: "#3B82F6" }} />
                  <span style={{ color: "#3B82F6" }}>Dials</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: "#F97316" }} />
                  <span style={{ color: "#F97316" }}>Connects</span>
                </div>
              </div>
            </div>

            {loading ? (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>Loading chart...</p>
            ) : dailySeries.length === 0 ? (
              <p style={{ color: "#374151", fontSize: 13 }}>No data for this period.</p>
            ) : (
              <div style={{ position: "relative" }} onMouseLeave={() => setTooltip(null)}>
                {/* Floating tooltip */}
                {tooltip && (
                  <div
                    style={{
                      position: "fixed",
                      top: tooltip.y - 80,
                      left: tooltip.x - 70,
                      background: "#1A2B45",
                      border: "1px solid #2d4060",
                      borderRadius: 8,
                      padding: "9px 14px",
                      fontSize: 12,
                      color: "#E5E7EB",
                      zIndex: 9999,
                      pointerEvents: "none",
                      whiteSpace: "nowrap",
                      boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 5, color: "#fff", fontSize: 11 }}>{tooltip.label}</div>
                    <div style={{ color: "#3B82F6", marginBottom: 2 }}>📞 {tooltip.dials} dials</div>
                    <div style={{ color: "#F97316" }}>🤝 {tooltip.connects} connects</div>
                  </div>
                )}

                {/* Bars */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 4,
                    height: chartHeight,
                    paddingBottom: 26,
                    position: "relative",
                  }}
                >
                  {/* Grid lines */}
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: 0, right: 0,
                        bottom: 26 + (i / 4) * (chartHeight - 26),
                        height: 1,
                        background: i === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                        pointerEvents: "none",
                      }}
                    />
                  ))}

                  {dailySeries.map((point: any, idx: number) => {
                    const usableHeight = chartHeight - 30;
                    const dialH = maxDials > 0 ? Math.max(3, ((point.dials || 0) / maxDials) * usableHeight) : 3;
                    const connectH = maxDials > 0 ? Math.max(3, ((point.connects || 0) / maxDials) * usableHeight) : 3;
                    const label = point.label || point.date || "";
                    const shortLabel = label.length > 6 ? label.slice(-5) : label;
                    return (
                      <div
                        key={idx}
                        style={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          height: "100%",
                          justifyContent: "flex-end",
                          position: "relative",
                          zIndex: 1,
                          cursor: "crosshair",
                        }}
                        onMouseEnter={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setTooltip({
                            x: rect.left + rect.width / 2,
                            y: rect.top,
                            dials: point.dials || 0,
                            connects: point.connects || 0,
                            label,
                          });
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, width: "100%", justifyContent: "center" }}>
                          <div
                            style={{
                              borderRadius: "3px 3px 0 0",
                              minHeight: 3,
                              flex: 1,
                              maxWidth: 16,
                              height: dialH,
                              background: "#3B82F6",
                            }}
                          />
                          <div
                            style={{
                              borderRadius: "3px 3px 0 0",
                              minHeight: 3,
                              flex: 1,
                              maxWidth: 16,
                              height: connectH,
                              background: "#F97316",
                            }}
                          />
                        </div>
                        <span style={{
                          fontSize: 9,
                          color: "#4B5563",
                          textAlign: "center",
                          position: "absolute",
                          bottom: 0,
                          left: "50%",
                          transform: "translateX(-50%)",
                          whiteSpace: "nowrap",
                        }}>
                          {shortLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── TOP OBJECTIONS — full width ── */}
          <TopObjectionsWidget />

          {/* ── UPCOMING APPOINTMENTS ── */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#374151", marginBottom: 8 }}>
              Upcoming Appointments
            </div>
            <div
              style={{
                background: "#0B1220",
                border: "1px solid rgba(255,255,255,0.04)",
                borderRadius: 10,
                padding: appointmentsLoading || appointments.length === 0 ? 0 : 2,
              }}
            >
              {appointmentsLoading ? (
                <div style={{ padding: "14px 16px", fontSize: 13, color: "#94A3B8" }}>
                  Loading appointments...
                </div>
              ) : appointments.length === 0 ? (
                <div style={{ padding: "14px 16px", fontSize: 13, color: "#6B7280" }}>
                  No upcoming appointments
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    overflowX: "auto",
                    padding: "8px",
                  }}
                >
                  {appointments.map((appointment) => (
                    <div
                      key={appointment._id}
                      style={{
                        position: "relative",
                        flex: "0 0 160px",
                        width: 160,
                        height: 126,
                        background: "#111D35",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 10,
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => callLead(appointment._id)}
                        title={`Call ${appointment.displayName || "lead"}`}
                        aria-label={`Call ${appointment.displayName || "lead"}`}
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          zIndex: 2,
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          border: "1px solid rgba(52,211,153,0.28)",
                          background: "rgba(16,185,129,0.14)",
                          color: "#6EE7B7",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                        }}
                      >
                        <FaPhoneAlt size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openLead(appointment._id)}
                        style={{
                          width: "100%",
                          height: "100%",
                          border: "none",
                          background: "transparent",
                          padding: "12px",
                          paddingRight: 40,
                          textAlign: "left",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            color: "#F8FAFC",
                            fontSize: 14,
                            fontWeight: 700,
                            lineHeight: 1.25,
                            maxWidth: "100%",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {appointment.displayName || "Unknown Lead"}
                        </div>
                        <div style={{ color: "#CBD5E1", fontSize: 12, lineHeight: 1.25 }}>
                          {formatAppointmentTime(appointment.appointmentTime)}
                        </div>
                        {appointment.folderName ? (
                          <span
                            style={{
                              border: "1px solid rgba(96,165,250,0.25)",
                              background: "rgba(96,165,250,0.1)",
                              color: "#93C5FD",
                              borderRadius: 999,
                              padding: "2px 8px",
                              fontSize: 10,
                              fontWeight: 700,
                              lineHeight: 1.4,
                              maxWidth: "100%",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {appointment.folderName}
                          </span>
                        ) : null}
                        <div
                          style={{
                            marginTop: "auto",
                            color: "#94A3B8",
                            fontSize: 11,
                            lineHeight: 1.2,
                            maxWidth: "100%",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          State: {appointment.state || "Unknown"}
                        </div>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── LEAD SOURCE TABLE ── */}
          <LeadSourceROIWidget />
        </>
      )}

      {view === "ai" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {aiCards.map((c) => (
              <div
                key={c.label}
                style={{
                  background: "#111D35",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6B7280" }}>
                  {c.label}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#F9FAFB", lineHeight: 1 }}>
                  {c.value}
                </div>
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
    const emailEnc = encodeURIComponent(String(session.user.email));
    let destination: string;
    if ((user as any)?.emailVerified === true) {
      const bp = new URLSearchParams({ email: String(session.user.email), trial: "1" });
      const uc = String((user as any)?.usedCode || "").trim();
      if (uc) bp.set("promoCode", uc);
      destination = `/billing?${bp.toString()}`;
    } else {
      destination = `/verify-email?email=${emailEnc}`;
    }
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
