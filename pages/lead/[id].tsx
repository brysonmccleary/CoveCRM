// pages/lead/[id].tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import toast from "react-hot-toast";
import dynamic from "next/dynamic";

const CallPanelClose = dynamic<{
  leadId: string;
  userHasAI: boolean;
  defaultFromNumber?: string;
  onOpenCall?: (callId: string) => void;
}>(() => import("@/components/CallPanelClose"), {
  ssr: false,
  loading: () => null,
});

type Lead = {
  id: string;
  _id?: string;
  userEmail?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  ["First Name"]?: string;
  ["Last Name"]?: string;
  Phone?: string;
  phone?: string;
  Email?: string;
  email?: string;
  Notes?: string;
  notes?: string;
  status?: string;
  folderId?: string | null;
  assignedDrips?: string[];
  dripProgress?: { dripId: string; startedAt?: string; lastSentIndex?: number }[];
  [key: string]: any;
};

type CallRow = {
  id: string;
  callSid: string;
  userEmail: string;
  leadId?: string;
  direction?: "inbound" | "outbound";
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  talkTime?: number;
  recordingUrl?: string;
  hasRecording?: boolean;

  // legacy fields (kept)
  aiSummary?: string;
  aiActionItems?: string[];
  aiBullets?: string[];
  aiSentiment?: "positive" | "neutral" | "negative";
  hasAI?: boolean;

  // ✅ structured AI overview
  aiOverviewReady?: boolean;
  aiOverview?: {
    overviewBullets: string[];
    keyDetails: string[];
    objections: string[];
    questions: string[];
    nextSteps: string[];
    outcome:
      | "Booked"
      | "Callback"
      | "Not Interested"
      | "No Answer"
      | "Voicemail"
      | "Other";
    appointmentTime?: string;
    sentiment?: "Positive" | "Neutral" | "Negative";
    generatedAt: string;
    version: 1;
  };
};

type HistoryEvent =
  | {
      type: "sms";
      id: string;
      dir: "inbound" | "outbound" | "ai";
      text: string;
      date: string;
      sid?: string;
      status?: string;
    }
  | {
      type: "call";
      id: string;
      date: string;
      durationSec?: number;
      status?: string;
      recordingUrl?: string;
      summary?: string;
      sentiment?: string;
    }
  | { type: "note"; id: string; date: string; text: string }
  | { type: "status"; id: string; date: string; from?: string; to?: string }
  | {
      type: "booking";
      id: string;
      date: string;
      title?: string;
      startsAt?: string;
    }
  | {
      type: "ai_outcome";
      id: string;
      date: string;
      message?: string;
      outcome?: string;
      recordingId?: string;
    };

// ---- Campaigns (UI-only)
type UICampaign = {
  _id: string;
  name: string;
  key?: string;
  isActive?: boolean;
  active?: boolean;
};

const LEADS_URL = "/dashboard?tab=leads";

// ✅ Only hide true internal/system keys
const HIDDEN_LEAD_KEYS = new Set([
  "_id",
  "id",
  "folderId",
  "createdAt",
  "ownerId",
  "userEmail",
]);

function safeBullets(v: any, max = 12): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function outcomeBadgeClasses(outcome?: string) {
  const o = String(outcome || "").toLowerCase();
  if (o.includes("book"))
    return "bg-emerald-900/40 text-emerald-300 border border-emerald-700/40";
  if (o.includes("callback"))
    return "bg-sky-900/40 text-sky-300 border border-sky-700/40";
  if (o.includes("not"))
    return "bg-rose-900/40 text-rose-300 border border-rose-700/40";
  if (o.includes("no answer"))
    return "bg-gray-800/60 text-gray-200 border border-gray-700/60";
  if (o.includes("voicemail"))
    return "bg-gray-800/60 text-gray-200 border border-gray-700/60";
  return "bg-white/10 text-gray-200 border border-white/10";
}

function titleCaseSentiment(v?: string) {
  const s = String(v || "").toLowerCase();
  if (s === "positive") return "Positive";
  if (s === "neutral") return "Neutral";
  if (s === "negative") return "Negative";
  return "";
}

function normalizeDisplayValue(value: any) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() ? value : "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // arrays/objects
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function LeadProfileDial() {
  const router = useRouter();
  const { id } = router.query;

  const [lead, setLead] = useState<Lead | null>(null);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [historyLines, setHistoryLines] = useState<string[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [callsLoading, setCallsLoading] = useState(false);

  const userHasAI = true;

  // ---- Enroll modal UI state
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<UICampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [startAtLocal, setStartAtLocal] = useState<string>("");
  const [enrolling, setEnrolling] = useState(false);

  // ---- Unenroll modal UI state
  const [unenrollOpen, setUnenrollOpen] = useState(false);
  const [activeDripIds, setActiveDripIds] = useState<string[]>([]);
  const [activeDripsLoading, setActiveDripsLoading] = useState(false);
  const [removeCampaignId, setRemoveCampaignId] = useState<string>("");
  const [removing, setRemoving] = useState(false);

  // ✅ Inline edit state (LEFT panel)
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // ---------- helpers ----------
  const formatPhone = (phone = "") => {
    const clean = String(phone).replace(/\D/g, "");
    if (clean.length === 10)
      return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
    if (clean.length === 11 && clean.startsWith("1"))
      return `${clean.slice(0, 1)}-${clean.slice(1, 4)}-${clean.slice(4, 7)}-${clean.slice(7)}`;
    return phone;
  };

  const fmtDateTime = (d?: string | Date) => {
    if (!d) return "—";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleString();
  };

  const fetchLeadById = useCallback(async (lookup: string) => {
    const r = await fetch(`/api/get-lead?id=${encodeURIComponent(lookup)}`, {
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({} as any));
    if (r.ok && j?.lead) {
      setLead({ id: j.lead._id, ...j.lead });
      setResolvedId(j.lead._id);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!id) return;
      const idStr = Array.isArray(id) ? id[0] : String(id);

      if (await fetchLeadById(idStr)) return;

      // fallback by phone if looks like a phone
      const digits = idStr.replace(/\D+/g, "");
      if (digits.length >= 10) {
        const r = await fetch(`/api/get-lead?phone=${encodeURIComponent(idStr)}`, {
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({} as any));
        if (r.ok && j?.lead) {
          setLead({ id: j.lead._id, ...j.lead });
          setResolvedId(j.lead._id);
          return;
        }
      }

      console.error("Error fetching lead");
      toast.error("Lead not found.");
    };
    run();
  }, [id, fetchLeadById]);

  const loadHistory = useCallback(async () => {
    const key = resolvedId || (id ? String(id) : "");
    if (!key) return;

    try {
      setHistLoading(true);
      const r = await fetch(`/api/leads/history?id=${encodeURIComponent(key)}&limit=50`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Failed to load history");

      const lines: string[] = [];
      (j.events || []).forEach((ev: HistoryEvent) => {
        if (ev.type === "note") {
          lines.push(`📝 ${ev.text} • ${fmtDateTime(ev.date)}`);
        } else if (ev.type === "sms") {
          const dir =
            ev.dir === "inbound"
              ? "⬅️ Inbound SMS"
              : ev.dir === "outbound"
              ? "➡️ Outbound SMS"
              : "🤖 AI SMS";
          const status = ev.status ? ` • ${ev.status}` : "";
          lines.push(`${dir}: ${ev.text}${status} • ${fmtDateTime(ev.date)}`);
        } else if (ev.type === "booking") {
          const title = ev.title || "Booked Appointment";
          const when = ev.startsAt ? fmtDateTime(ev.startsAt) : fmtDateTime(ev.date);
          lines.push(`📅 ${title} • ${when}`);
        } else if (ev.type === "status") {
          lines.push(`🔖 Status: ${ev.to || "Updated"} • ${fmtDateTime(ev.date)}`);
        } else if (ev.type === "ai_outcome") {
          const label = ev.message || "🤖 AI Dialer outcome";
          lines.push(`🤖 ${label} • ${fmtDateTime(ev.date)}`);
        }
      });

      setHistoryLines(lines);
    } catch (e) {
      console.error(e);
    } finally {
      setHistLoading(false);
    }
  }, [resolvedId, id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ---------- Load calls (for AI overview only; recordings are RIGHT panel only) ----------
  const loadCalls = useCallback(async () => {
    if (!resolvedId) return;
    try {
      setCallsLoading(true);
      const r = await fetch(`/api/calls?leadId=${encodeURIComponent(resolvedId)}`, {
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j?.message || "Failed to load calls");
      const list: CallRow[] = Array.isArray(j?.calls) ? j.calls : [];
      setCalls(list);
    } catch (e) {
      console.error(e);
    } finally {
      setCallsLoading(false);
    }
  }, [resolvedId]);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  // ✅ Prefer structured overview; fallback to legacy (aiBullets/aiSummary)
  const latestOverviewCall = useMemo(() => {
    const sorted = calls.slice().sort((a, b) => {
      const da = new Date(a.startedAt || a.completedAt || 0).getTime();
      const db = new Date(b.startedAt || b.completedAt || 0).getTime();
      return db - da;
    });

    return (
      sorted.find((c) => (c as any).aiOverviewReady && (c as any).aiOverview) ||
      sorted.find(
        (c) =>
          !!c.aiSummary ||
          (Array.isArray(c.aiBullets) && c.aiBullets.length > 0) ||
          (Array.isArray(c.aiActionItems) && c.aiActionItems.length > 0)
      ) ||
      null
    );
  }, [calls]);

  const closeOverview = useMemo(() => {
    const c = latestOverviewCall as any;
    if (!c) return null;

    const o = c?.aiOverview;

    // ✅ structured path
    if (c?.aiOverviewReady && o) {
      return {
        overviewBullets: safeBullets(o.overviewBullets, 6),
        keyDetails: safeBullets(o.keyDetails, 6),
        objections: safeBullets(o.objections, 6),
        questions: safeBullets(o.questions, 6),
        nextSteps: safeBullets(o.nextSteps, 6),
        outcome: String(o.outcome || "Other"),
        appointmentTime: o.appointmentTime ? String(o.appointmentTime) : "",
        sentiment: o.sentiment ? String(o.sentiment) : "",
        generatedAt: o.generatedAt ? String(o.generatedAt) : "",
        version: 1 as const,
      };
    }

    // ✅ legacy fallback path
    const legacyBullets = Array.isArray(c.aiBullets) ? c.aiBullets : [];
    const legacyActions = Array.isArray(c.aiActionItems) ? c.aiActionItems : [];

    return {
      overviewBullets: legacyBullets.length
        ? safeBullets(legacyBullets, 6)
        : c.aiSummary
        ? [String(c.aiSummary)]
        : [],
      keyDetails: legacyActions.length ? safeBullets(legacyActions, 6) : [],
      objections: [],
      questions: [],
      nextSteps: [],
      outcome: "Other",
      appointmentTime: "",
      sentiment: titleCaseSentiment(c.aiSentiment),
      generatedAt: c.completedAt ? String(c.completedAt) : "",
      version: 1 as const,
    };
  }, [latestOverviewCall]);

  // ---------- Save note ----------
  const handleSaveNote = async () => {
    if (!notes.trim() || !lead?.id) return toast.error("❌ Cannot save an empty note");
    try {
      const r = await fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          type: "note",
          message: notes.trim(),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message || "Failed to save note");
      }
      setHistoryLines((prev) => [`📝 ${notes.trim()} • ${new Date().toLocaleString()}`, ...prev]);
      setNotes("");
      toast.success("✅ Note saved!");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save note");
    }
  };

  // ---------- call ----------
  const startCall = () => {
    if (!lead?.id) return toast.error("Lead not loaded");
    router.push({ pathname: "/dial-session", query: { leadId: lead.id } });
  };

  const leadName = useMemo(() => {
    const full =
      `${lead?.firstName || lead?.["First Name"] || ""} ${lead?.lastName || lead?.["Last Name"] || ""}`.trim() ||
      lead?.name ||
      "";
    return full || "Lead";
  }, [lead]);

  // ---------- Campaigns list (for names + enroll modal) ----------
  useEffect(() => {
    const loadAllCampaigns = async () => {
      try {
        setCampaignsLoading(true);
        const r = await fetch(`/api/drips/campaigns`, { cache: "no-store" });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok) throw new Error(j?.error || "Failed to load campaigns");
        const list: UICampaign[] = Array.isArray(j?.campaigns) ? j.campaigns : [];
        setCampaigns(list);
      } catch (e: any) {
        toast.error(e?.message || "Failed to load campaigns");
      } finally {
        setCampaignsLoading(false);
      }
    };
    loadAllCampaigns();
  }, []);

  // ---------- Load active drips for UNENROLL modal only ----------
  const loadActiveForLead = useCallback(async () => {
    if (!resolvedId) return;
    try {
      setActiveDripsLoading(true);

      // Preferred: /api/drips/enrollments
      const resp = await fetch(`/api/drips/enrollments?leadId=${encodeURIComponent(resolvedId)}`, {
        cache: "no-store",
      });
      if (resp.ok) {
        const data = await resp.json().catch(() => ({} as any));
        const ids: string[] = Array.isArray(data?.enrollments)
          ? data.enrollments
              .filter((e: any) => e?.status === "active" || e?.status === "paused")
              .map((e: any) => String(e.campaignId))
          : [];
        setActiveDripIds([...new Set(ids)]);
        setRemoveCampaignId((cur) => (cur && ids.includes(cur) ? cur : ids[0] || ""));
        return;
      }

      // Fallbacks
      if (lead?.assignedDrips?.length) {
        const ids = [...new Set(lead.assignedDrips.map(String))];
        setActiveDripIds(ids);
        setRemoveCampaignId((cur) => (cur && ids.includes(cur) ? cur : ids[0] || ""));
        return;
      }
      if (lead?.dripProgress?.length) {
        const ids = [...new Set(lead.dripProgress.map((p) => String(p.dripId)))];
        setActiveDripIds(ids);
        setRemoveCampaignId((cur) => (cur && ids.includes(cur) ? cur : ids[0] || ""));
        return;
      }

      setActiveDripIds([]);
      setRemoveCampaignId("");
    } catch {
      setActiveDripIds([]);
      setRemoveCampaignId("");
    } finally {
      setActiveDripsLoading(false);
    }
  }, [resolvedId, lead]);

  const campaignNameById = useCallback(
    (id: string) => campaigns.find((c) => String(c._id) === String(id))?.name || id,
    [campaigns]
  );

  // ---------- Open modals ----------
  const openEnrollModal = () => {
    if (!resolvedId) return toast.error("Lead not loaded");
    setEnrollOpen(true);
  };

  const openUnenrollModal = async () => {
    if (!resolvedId) return toast.error("Lead not loaded");
    await loadActiveForLead();
    setUnenrollOpen(true);
  };

  // ---------- Enroll submit ----------
  const submitEnroll = async () => {
    if (!lead?.id) return toast.error("Lead not loaded");
    if (!selectedCampaignId) return toast.error("Pick a campaign");

    try {
      setEnrolling(true);
      const body: any = { leadId: lead.id, campaignId: selectedCampaignId };
      if (startAtLocal) {
        const localDate = new Date(startAtLocal);
        if (!Number.isNaN(localDate.getTime())) body.startAt = localDate.toISOString();
      }

      const r = await fetch(`/api/drips/enroll-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.success) throw new Error(j?.error || j?.message || "Failed to enroll lead");

      const enrolledName =
        j?.campaign?.name || campaigns.find((c) => c._id === selectedCampaignId)?.name || "campaign";
      setHistoryLines((prev) => [`🔖 Status: Enrolled to ${enrolledName} • ${new Date().toLocaleString()}`, ...prev]);

      toast.success(`✅ Enrolled in ${enrolledName}`);
      setEnrollOpen(false);
      setSelectedCampaignId("");
      setStartAtLocal("");
    } catch (e: any) {
      toast.error(e?.message || "Enrollment failed");
    } finally {
      setEnrolling(false);
    }
  };

  // ---------- Unenroll submit ----------
  const submitUnenroll = async () => {
    if (!lead?.id) return toast.error("Lead not loaded");
    if (!removeCampaignId) return toast.error("Select a drip to remove");
    try {
      setRemoving(true);
      const r = await fetch(`/api/drips/unenroll-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, campaignId: removeCampaignId }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.success) throw new Error(j?.error || j?.message || "Failed to remove");

      toast.success("✅ Removed from drip");
      setUnenrollOpen(false);
      setHistoryLines((prev) => [
        `🔖 Status: Removed from ${campaignNameById(removeCampaignId)} • ${new Date().toLocaleString()}`,
        ...prev,
      ]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove");
    } finally {
      setRemoving(false);
    }
  };

  // ---------- LEFT panel: inline edit helpers ----------
  const startEditingField = (key: string, rawValue: any) => {
    if (!lead?.id) return toast.error("Lead not loaded");
    setEditingKey(key);

    // For phone keys, store digits/pretty? -> store the raw string as displayed (editable)
    const display = normalizeDisplayValue(rawValue);
    setEditingValue(display === "—" ? "" : display);
  };

  const cancelEditingField = () => {
    setEditingKey(null);
    setEditingValue("");
    setSavingKey(null);
  };

  const saveEditingField = async () => {
    if (!lead?.id) return toast.error("Lead not loaded");
    if (!editingKey) return;

    const field = editingKey;
    const value = editingValue;

    try {
      setSavingKey(field);

      const r = await fetch("/api/leads/update-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, field, value }),
      });

      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || j?.success === false) {
        throw new Error(j?.message || j?.error || "Failed to update field");
      }

      // Update local state immediately
      setLead((prev) => {
        if (!prev) return prev;
        return { ...prev, [field]: value };
      });

      toast.success("✅ Updated");
      setEditingKey(null);
      setEditingValue("");
    } catch (e: any) {
      toast.error(e?.message || "Failed to update field");
    } finally {
      setSavingKey(null);
    }
  };

  const leftPanelEntries = useMemo(() => {
    const obj = lead || {};
    const entries = Object.entries(obj).filter(([key]) => !HIDDEN_LEAD_KEYS.has(key));

    // Stable ordering: common keys first, then everything else alphabetically
    const preferredOrder = [
      "firstName",
      "lastName",
      "First Name",
      "Last Name",
      "name",
      "Phone",
      "phone",
      "Email",
      "email",
      "status",
      "Notes",
      "notes",
    ];

    const prefSet = new Set(preferredOrder);

    const preferred: Array<[string, any]> = [];
    for (const k of preferredOrder) {
      const found = entries.find(([key]) => key === k);
      if (found) preferred.push(found);
    }

    const rest = entries
      .filter(([key]) => !prefSet.has(key))
      .sort(([a], [b]) => a.localeCompare(b));

    // Remove dupes if both name/firstName etc exist (keep the first occurrence)
    const seen = new Set<string>();
    const merged = [...preferred, ...rest].filter(([k]) => {
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return merged;
  }, [lead]);

  // ---------- Render ----------
  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen">
      <Sidebar />

      {/* LEFT (lead fields only; editable) */}
      <div className="w-[320px] p-4 border-r border-gray-700 bg-[#1e293b] overflow-y-auto">
        <div className="mb-2">
          <h2 className="text-xl font-bold">{leadName}</h2>
        </div>

        {leftPanelEntries.map(([key, rawValue]) => {
          let displayValue = rawValue;

          // Pretty phone formatting for display (still editable)
          if (key === "Phone" || key.toLowerCase() === "phone") {
            displayValue = formatPhone(String(rawValue || ""));
          }

          const isEditing = editingKey === key;
          const isSaving = savingKey === key;

          const valueText = normalizeDisplayValue(displayValue);
          const label = key.replace(/_/g, " ");

          const isLong =
            typeof rawValue === "string" ? rawValue.length > 60 : valueText.length > 80;

          return (
            <div key={key} className="py-1">
              <p className="text-xs text-gray-400 mb-1">{label}</p>

              {!isEditing ? (
                <button
                  type="button"
                  onClick={() => startEditingField(key, rawValue)}
                  className="w-full text-left rounded px-2 py-1.5 bg-white/0 hover:bg-white/5 border border-white/0 hover:border-white/10 transition"
                  title="Click to edit"
                >
                  <span className="text-sm text-gray-100 whitespace-pre-wrap break-words">
                    {valueText}
                  </span>
                </button>
              ) : (
                <div className="rounded border border-white/10 bg-[#0f172a] p-2">
                  {isLong ? (
                    <textarea
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      className="w-full text-sm text-white bg-transparent border-none focus:outline-none resize-y min-h-[72px]"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEditingField();
                        }
                        // (No Enter-to-save for textarea; users can click Save / blur)
                      }}
                      onBlur={() => {
                        // save on blur (matches your “edit live” intent)
                        saveEditingField();
                      }}
                    />
                  ) : (
                    <input
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      className="w-full text-sm text-white bg-transparent border-none focus:outline-none"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEditingField();
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveEditingField();
                        }
                      }}
                      onBlur={() => {
                        saveEditingField();
                      }}
                    />
                  )}

                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={cancelEditingField}
                      className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
                      disabled={isSaving}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={saveEditingField}
                      className="text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                      disabled={isSaving}
                    >
                      {isSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              )}

              <hr className="border-gray-800 my-2" />
            </div>
          );
        })}

        <p className="text-gray-500 mt-2 text-xs">
          Click any field value to edit live. Enter saves, Esc cancels.
        </p>
      </div>

      {/* CENTER */}
      <div className="flex-1 p-6 bg-[#0f172a] border-r border-gray-800 flex flex-col min-h-0">
        <div className="max-w-3xl flex flex-col min-h-0 flex-1">
          {/* Lead note input stays (this is NOT AI call overview) */}
          <h3 className="text-lg font-bold mb-2">Add a Note</h3>

          <div className="rounded-lg mb-2 bg-[#0f172a] border border-white/10">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-3 text-white rounded bg-transparent border-none focus:outline-none"
              rows={3}
              placeholder="Type notes here..."
            />
          </div>

          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={handleSaveNote}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md"
            >
              Save Note
            </button>
            <button
              type="button"
              onClick={startCall}
              className="text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-md"
            >
              Call
            </button>

            <button
              type="button"
              onClick={openEnrollModal}
              disabled={!lead?.id}
              className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 px-3 py-1.5 rounded-md"
            >
              Enroll in Drip
            </button>

            <button
              type="button"
              onClick={openUnenrollModal}
              disabled={!lead?.id}
              className="text-sm bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 px-3 py-1.5 rounded-md"
            >
              Remove from Drip
            </button>
          </div>

          {/* ✅ AI Call Overview (middle panel) */}
          <div className="mb-4 bg-[#0b1220] border border-white/10 rounded p-3">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold">AI Call Overview</h3>
              <div className="flex items-center gap-2">
                {callsLoading ? <span className="text-xs text-gray-400">Loading…</span> : null}
                <button
                  type="button"
                  onClick={() => loadCalls()}
                  className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
                >
                  Refresh
                </button>
              </div>
            </div>

            {!latestOverviewCall ? (
              <p className="text-gray-400 text-sm">No AI call overview yet for this lead.</p>
            ) : !closeOverview ? (
              <p className="text-gray-400 text-sm">AI call found, but overview data is missing.</p>
            ) : (
              <div className="mt-2 space-y-3">
                {/* Top row badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs border ${outcomeBadgeClasses(
                      closeOverview.outcome
                    )}`}
                  >
                    {closeOverview.outcome}
                  </span>
                  {closeOverview.sentiment ? (
                    <span className="px-2 py-0.5 rounded-full text-xs border bg-white/5 text-gray-200 border-white/10">
                      Sentiment: {closeOverview.sentiment}
                    </span>
                  ) : null}
                  {closeOverview.appointmentTime ? (
                    <span className="px-2 py-0.5 rounded-full text-xs border bg-white/5 text-gray-200 border-white/10">
                      Appt: {closeOverview.appointmentTime}
                    </span>
                  ) : null}
                </div>

                {/* Sections */}
                {closeOverview.overviewBullets.length ? (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Overview</div>
                    <ul className="space-y-1">
                      {closeOverview.overviewBullets.map((b, idx) => (
                        <li key={idx} className="text-sm text-gray-200 flex gap-2">
                          <span className="text-gray-400">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {closeOverview.keyDetails.length ? (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Key details</div>
                    <ul className="space-y-1">
                      {closeOverview.keyDetails.map((b, idx) => (
                        <li key={idx} className="text-sm text-gray-200 flex gap-2">
                          <span className="text-gray-400">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {closeOverview.objections.length ? (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Objections</div>
                    <ul className="space-y-1">
                      {closeOverview.objections.map((b, idx) => (
                        <li key={idx} className="text-sm text-gray-200 flex gap-2">
                          <span className="text-gray-400">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {closeOverview.questions.length ? (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Questions</div>
                    <ul className="space-y-1">
                      {closeOverview.questions.map((b, idx) => (
                        <li key={idx} className="text-sm text-gray-200 flex gap-2">
                          <span className="text-gray-400">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {closeOverview.nextSteps.length ? (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Next steps</div>
                    <ul className="space-y-1">
                      {closeOverview.nextSteps.map((b, idx) => (
                        <li key={idx} className="text-sm text-gray-200 flex gap-2">
                          <span className="text-gray-400">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="text-xs text-gray-500 pt-1">
                  Based on most recent AI call •{" "}
                  {fmtDateTime(
                    (latestOverviewCall as any)?.startedAt || (latestOverviewCall as any)?.completedAt
                  )}
                  {closeOverview.generatedAt ? (
                    <>
                      {" "}
                      • Overview generated {fmtDateTime(closeOverview.generatedAt)}
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold mb-2">Interaction History</h3>
            {histLoading ? <span className="text-xs text-gray-400">Loading…</span> : null}
          </div>

          <div className="bg-[#0b1220] border border-white/10 rounded p-3 flex-1 min-h-0 overflow-y-auto">
            {historyLines.length === 0 ? (
              <p className="text-gray-400">No interactions yet.</p>
            ) : (
              historyLines.map((item, idx) => (
                <div key={idx} className="border-b border-white/10 py-2 text-sm">
                  {item}
                </div>
              ))
            )}
          </div>

          <div className="mt-4">
            <button
              onClick={() => {
                try {
                  router.replace(LEADS_URL);
                } catch {
                  if (typeof window !== "undefined") window.location.replace(LEADS_URL);
                }
              }}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
            >
              Back to Leads
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="w-[400px] p-4 bg-[#0b1220] flex flex-col min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto">
          {lead?.id ? (
            <CallPanelClose
              leadId={lead.id}
              userHasAI={userHasAI}
              defaultFromNumber={process.env.NEXT_PUBLIC_DEFAULT_FROM as string | undefined}
              onOpenCall={(callId) => router.push(`/calls/${callId}`)}
            />
          ) : null}
        </div>
      </div>

      {/* Enroll Modal */}
      {enrollOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setEnrollOpen(false)} />
          <div className="relative w-full max-w-md mx-4 rounded-lg border border-white/10 bg-[#0f172a] p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">Enroll in Drip</h3>
              <button onClick={() => setEnrollOpen(false)} className="text-gray-300 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Campaign</label>
                <select
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  className="w-full bg-[#1e293b] text-white border border-white/10 rounded p-2"
                >
                  <option value="">
                    {campaignsLoading ? "Loading…" : "-- Select a campaign --"}
                  </option>
                  {campaigns.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  Optional Start Time <span className="text-gray-500">(local)</span>
                </label>
                <input
                  type="datetime-local"
                  value={startAtLocal}
                  onChange={(e) => setStartAtLocal(e.target.value)}
                  className="w-full bg-[#1e293b] text-white border border-white/10 rounded p-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank to start immediately; scheduler will handle timing.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setEnrollOpen(false)}
                className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={submitEnroll}
                disabled={enrolling || !selectedCampaignId}
                className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50"
              >
                {enrolling ? "Enrolling…" : "Enroll"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Unenroll Modal */}
      {unenrollOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setUnenrollOpen(false)} />
          <div className="relative w-full max-w-md mx-4 rounded-lg border border-white/10 bg-[#0f172a] p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">Remove from Drip</h3>
              <button onClick={() => setUnenrollOpen(false)} className="text-gray-300 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Active Campaign</label>
                <select
                  value={removeCampaignId}
                  onChange={(e) => setRemoveCampaignId(e.target.value)}
                  className="w-full bg-[#1e293b] text-white border border-white/10 rounded p-2"
                >
                  <option value="">
                    {activeDripsLoading
                      ? "Loading…"
                      : activeDripIds.length
                      ? "-- Select a campaign --"
                      : "No active drips"}
                  </option>
                  {activeDripIds.map((cid) => (
                    <option key={cid} value={cid}>
                      {campaignNameById(cid)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Only campaigns this lead is currently enrolled in are shown.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setUnenrollOpen(false)}
                className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={submitUnenroll}
                disabled={removing || !removeCampaignId}
                className="px-4 py-2 rounded bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
              >
                {removing ? "Removing…" : "Confirm Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
