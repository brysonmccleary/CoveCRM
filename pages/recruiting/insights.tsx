import { useEffect, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import DashboardLayout from "@/components/DashboardLayout";
import { isRecruitingAdminEmail } from "@/lib/recruiting/access";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

type Range = "today" | "7d" | "30d" | "all";
type Platform = "all" | "instagram" | "linkedin";
type Insights = {
  totals: { targetedInteractions: number; postLikes: number; storyLikes: number; follows: number; connections: number; dmsSent: number; replies: number; responseRate: number; safetySkips: number };
  platforms: { instagram: { targetedInteractions: number; dmsSent: number }; linkedin: { targetedInteractions: number; dmsSent: number } };
  daily: Array<{ date: string; targetedInteractions: number }>;
  growth: { instagram: { starting: number; current: number; netGrowth: number } | null; linkedin: { starting: number; current: number; netGrowth: number } | null; note: string };
};

const empty: Insights = { totals: { targetedInteractions: 0, postLikes: 0, storyLikes: 0, follows: 0, connections: 0, dmsSent: 0, replies: 0, responseRate: 0, safetySkips: 0 }, platforms: { instagram: { targetedInteractions: 0, dmsSent: 0 }, linkedin: { targetedInteractions: 0, dmsSent: 0 } }, daily: [], growth: { instagram: null, linkedin: null, note: "Growth tracking starts after the first connected-account baseline." } };
const rangeLabels: Record<Range, string> = { today: "Today", "7d": "7 days", "30d": "30 days", all: "All time" };

export default function RecruitingInsightsPage() {
  const [range, setRange] = useState<Range>("30d");
  const [platform, setPlatform] = useState<Platform>("all");
  const [data, setData] = useState<Insights>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    fetch(`/api/recruiting/insights?range=${range}&platform=${platform}`)
      .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => ({})) }))
      .then(({ ok, body }) => { if (!active) return; if (!ok) setError("Insights are temporarily unavailable. Please try again."); else setData(body); })
      .catch(() => { if (active) setError("Insights are temporarily unavailable. Please try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range, platform]);
  const maxDaily = useMemo(() => Math.max(1, ...data.daily.map((item) => item.targetedInteractions)), [data.daily]);
  const cards = [
    ["Targeted interactions", data.totals.targetedInteractions],
    ["Post likes", data.totals.postLikes],
    ["Story likes", data.totals.storyLikes],
    ["Profiles followed", data.totals.follows],
    ["Connections sent", data.totals.connections],
    ["DMs sent", data.totals.dmsSent],
    ["Replies", data.totals.replies],
    ["Response rate", `${data.totals.responseRate}%`],
  ] as const;
  return <DashboardLayout><div className="mx-auto max-w-6xl space-y-6 pb-16 text-white">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/recruiting" className="text-xs font-semibold text-indigo-300 hover:text-indigo-200">← Back to automation</Link><h1 className="mt-2 text-3xl font-bold tracking-tight">Social Insights</h1><p className="mt-2 text-sm text-slate-400">Clear proof of every targeted interaction CoveCRM completes.</p></div><span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">Admin-only preview</span></header>
    <div className="flex flex-wrap justify-between gap-3"><div className="flex gap-2">{(["all", "instagram", "linkedin"] as Platform[]).map((value) => <button key={value} type="button" onClick={() => setPlatform(value)} className={`rounded-lg border px-4 py-2 text-xs font-semibold ${platform === value ? "border-indigo-400 bg-indigo-500/20 text-white" : "border-white/10 text-slate-400"}`}>{value === "all" ? "Combined" : value === "instagram" ? "Instagram" : "LinkedIn"}</button>)}</div><div className="flex gap-2">{(["today", "7d", "30d", "all"] as Range[]).map((value) => <button key={value} type="button" onClick={() => setRange(value)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${range === value ? "border-indigo-400 bg-indigo-500/20 text-white" : "border-white/10 text-slate-400"}`}>{rangeLabels[value]}</button>)}</div></div>
    {error && <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">{error}</div>}
    <section className="rounded-2xl border border-indigo-400/20 bg-gradient-to-r from-indigo-600/20 to-violet-600/10 p-6"><p className="text-sm font-semibold text-indigo-200">Targeted interactions</p><p className="mt-2 text-5xl font-bold">{loading ? "—" : data.totals.targetedInteractions.toLocaleString()}</p><p className="mt-2 text-sm text-slate-400">Every completed like, story like, follow, connection, or DM counts as one targeted interaction.</p></section>
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">{cards.map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-slate-900/80 p-4"><p className="text-2xl font-bold">{loading ? "—" : typeof value === "number" ? value.toLocaleString() : value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div>)}</section>
    <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-6"><div className="flex items-end justify-between"><div><h2 className="text-lg font-semibold">Daily activity</h2><p className="mt-1 text-sm text-slate-400">Targeted interactions completed each day.</p></div><p className="text-xs text-slate-500">{rangeLabels[range]}</p></div><div className="mt-6 flex h-48 items-end gap-2 overflow-x-auto">{data.daily.length ? data.daily.map((item) => <div key={item.date} className="flex min-w-8 flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] text-slate-400">{item.targetedInteractions}</span><div title={`${item.date}: ${item.targetedInteractions} targeted interactions`} className="w-full rounded-t bg-gradient-to-t from-indigo-600 to-violet-400" style={{ height: `${Math.max(6, (item.targetedInteractions / maxDaily) * 150)}px` }} /><span className="text-[9px] text-slate-600">{item.date.slice(5)}</span></div>) : <div className="m-auto text-sm text-slate-500">Completed activity will appear here.</div>}</div></section>
    <section className="grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-slate-900/80 p-6"><h2 className="text-lg font-semibold">By platform</h2><div className="mt-4 space-y-3">{(["instagram", "linkedin"] as const).map((name) => <div key={name} className="flex items-center justify-between rounded-xl bg-slate-950/50 p-4"><div><p className="font-semibold capitalize">{name}</p><p className="text-xs text-slate-500">{data.platforms[name].dmsSent.toLocaleString()} DMs sent</p></div><p className="text-2xl font-bold">{data.platforms[name].targetedInteractions.toLocaleString()}</p></div>)}</div></div><div className="rounded-2xl border border-white/10 bg-slate-900/80 p-6"><h2 className="text-lg font-semibold">Growth tracking</h2><p className="mt-2 text-sm leading-relaxed text-slate-400">Follower and connection growth is reported separately from CoveCRM actions so the numbers stay honest.</p><div className="mt-4 grid grid-cols-2 gap-3">{([['instagram', 'Followers'], ['linkedin', 'Connections']] as const).map(([name, label]) => { const growth = data.growth[name]; return <div key={name} className="rounded-xl bg-slate-950/50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{growth ? growth.current.toLocaleString() : "—"}</p><p className={`mt-1 text-xs ${growth && growth.netGrowth > 0 ? "text-emerald-300" : "text-slate-500"}`}>{growth ? `${growth.netGrowth >= 0 ? "+" : ""}${growth.netGrowth.toLocaleString()} this period` : "Waiting for baseline"}</p></div>; })}</div><p className="mt-4 text-xs leading-relaxed text-slate-500">{data.growth.note}</p><p className="mt-3 text-xs text-emerald-300">{data.totals.safetySkips.toLocaleString()} unnecessary or duplicate interactions safely prevented.</p></div></section>
  </div></DashboardLayout>;
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!isRecruitingAdminEmail(session?.user?.email)) return { notFound: true };
  return { props: {} };
};
