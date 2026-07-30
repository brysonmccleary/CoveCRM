// pages/lead/[id].tsx
import { stopRingback } from "@/utils/ringAudio";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import { sanitizeLeadNoteForDisplay } from "@/lib/leads/noteVisibility";
import toast from "react-hot-toast";
import SaleModal from "@/components/SaleModal";
import dynamic from "next/dynamic";
import ChatThread from "@/components/messages/ChatThread";
import { getSocket } from "@/lib/socketClient";
import { getNumberState } from "@/lib/twilio/localPresence";
import CallCoachReport from "@/components/CallCoachReport";


import { useInlineLeadCall } from "@/lib/dial/useInlineLeadCall";

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
  ["Phone Number"]?: string;
  ["phoneNumber"]?: string;

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

  aiSummary?: string;
  aiActionItems?: string[];
  aiBullets?: string[];
  aiSentiment?: "positive" | "neutral" | "negative";
  hasAI?: boolean;

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
  | { type: "note"; id: string; date: string; text: string }
  | { type: "status"; id: string; date: string; from?: string; to?: string }
  | { type: "booking"; id: string; date: string; title?: string; startsAt?: string }
  | {
      type: "ai_outcome";
      id: string;
      date: string;
      message?: string;
      outcome?: string;
      recordingId?: string;
    };

type DisplayNote = { id: string; text: string; date: string };

type UICampaign = {
  _id: string;
  name: string;
  key?: string;
  isActive?: boolean;
  active?: boolean;
};

type NumberEntry = { id: string; phoneNumber: string; sid: string; capabilities?: any };

type LeadMemoryProfileView = {
  shortSummary?: string;
  nextBestAction?: string;
  objections?: string[];
  preferences?: Record<string, any>;
  lastUpdatedAt?: string;
  keyFacts?: { key: string; value: string; confidence?: number }[];
};

const LEADS_URL = "/dashboard?tab=leads";


/* ---------------- helpers ---------------- */
function safeBullets(v: any, max = 12): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function outcomeBadgeClasses(outcome?: string) {
  const o = String(outcome || "").toLowerCase();
  if (o.includes("book")) return "bg-emerald-900/40 text-emerald-300 border border-emerald-700/40";
  if (o.includes("callback")) return "bg-sky-900/40 text-sky-300 border border-sky-700/40";
  if (o.includes("not")) return "bg-rose-900/40 text-rose-300 border border-rose-700/40";
  if (o.includes("no answer")) return "bg-gray-800/60 text-gray-200 border border-gray-700/60";
  if (o.includes("voicemail")) return "bg-gray-800/60 text-gray-200 border border-gray-700/60";
  return "bg-white/10 text-gray-200 border border-white/10";
}

function titleCaseSentiment(v?: string) {
  const s = String(v || "").toLowerCase();
  if (s === "positive") return "Positive";
  if (s === "neutral") return "Neutral";
  if (s === "negative") return "Negative";
  return "";
}

function normalizeKey(k: string) {
  return String(k || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function formatDisplayValue(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";

  try {
    if (Array.isArray(v)) {
      const cleaned = v
        .map((x) => (x === null || x === undefined ? "" : String(x).trim()))
        .filter(Boolean);
      if (cleaned.length === 0) return "";
      if (cleaned.length <= 6) return cleaned.join(", ");
      return `${cleaned.slice(0, 6).join(", ")} … (+${cleaned.length - 6})`;
    }

    const s = JSON.stringify(v);
    if (!s || s === "{}") return "";
    if (s.length <= 140) return s;
    return s.slice(0, 140) + "…";
  } catch {
    return String(v);
  }
}

function looksLikeNotesKey(rawKey: string) {
  const nk = normalizeKey(rawKey);
  if (nk.includes("note")) return true;
  if (nk.includes("aidhistory")) return true;
  if (nk.includes("aicall")) return true;
  if (nk.includes("dialer")) return true;
  if (nk.includes("fallback")) return true;
  if (nk.includes("transcript")) return true;
  return false;
}

function looksLikeSystemKey(rawKey: string) {
  const nk = normalizeKey(rawKey);
  const blockedExact = new Set([
    "_id",
    "id",
    "userid",
    "ownerid",
    "useremail",
    "folderid",
    "assigneddrips",
    "dripprogress",
    "createdat",
    "updatedat",
    "__v",
    "history",
    "interactionhistory",
    "normalizedphone",
    "phonelast10",
  ]);
  if (blockedExact.has(nk)) return true;
  return false;
}

function tryParseJsonObject(v: any): Record<string, any> | null {
  if (!v) return null;
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, any>;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (!(s.startsWith("{") && s.endsWith("}"))) return null;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    return null;
  } catch {
    return null;
  }
}

function flattenDisplayFields(lead: any) {
  const out: Record<string, any> = {};
  if (!lead || typeof lead !== "object") return out;

  Object.keys(lead).forEach((k) => {
    out[k] = lead[k];
  });

  const candidates = ["customFields", "fields", "data", "sheet", "payload"];
  for (const c of candidates) {
    const obj = lead?.[c];
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      Object.keys(obj).forEach((k) => {
        if (out[k] === undefined) out[k] = obj[k];
      });
    }
  }

  const rawRowObj = tryParseJsonObject(lead?.rawRow);
  if (rawRowObj) {
    Object.keys(rawRowObj).forEach((k) => {
      if (out[k] === undefined) out[k] = rawRowObj[k];
    });
  }

  return out;
}

function labelFromKey(k: string) {
  const key = String(k || "").trim();
  if (normalizeKey(key) === "campaignname") return "Campaign";
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
}
/* ---------------------------------------- */

export default function LeadProfileDial() {
  // Safety: opening a lead should never carry over outbound ringback audio.
  useEffect(() => {
    try { stopRingback(); } catch {}
  }, []);

  useEffect(() => {
    fetch("/api/settings/profile")
      .then((r) => r.json())
      .then((d) => { if (d?.defaultCompPercentage) setDefaultComp(Number(d.defaultCompPercentage)); })
      .catch(() => {});
  }, []);

  const router = useRouter();
  // ---------- Folder context for Prev/Next ----------
  const folderId = useMemo(() => {
    const v = (router.query as any)?.folderId;
    return typeof v === "string" && v.trim() ? v.trim() : "";
  }, [router.query]);

  const [folderLeadIds, setFolderLeadIds] = useState<string[]>([]);
  const [folderLeadIdsLoading, setFolderLeadIdsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!folderId) {
      setFolderLeadIds([]);
      return;
    }
    (async () => {
      try {
        setFolderLeadIdsLoading(true);
        const r = await fetch(`/api/get-leads-by-folder?folderId=${encodeURIComponent(folderId)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({} as any));
        const leads = Array.isArray(j?.leads) ? j.leads : [];
        const ids = leads
          .map((x: any) => String(x?._id || x?.id || "").trim())
          .filter(Boolean);
        setFolderLeadIds(ids);
      } catch {
        setFolderLeadIds([]);
      } finally {
        setFolderLeadIdsLoading(false);
      }
    })();
  }, [folderId]);

  const { prevLeadId, nextLeadId } = useMemo(() => {
    const current = String((router.query as any)?.id || "").trim();
    if (!folderId || !current || !folderLeadIds.length) return { prevLeadId: "", nextLeadId: "" };
    const idx = folderLeadIds.findIndex((x) => x === current);
    if (idx < 0) return { prevLeadId: "", nextLeadId: "" };
    return {
      prevLeadId: idx > 0 ? folderLeadIds[idx - 1] : "",
      nextLeadId: idx + 1 < folderLeadIds.length ? folderLeadIds[idx + 1] : "",
    };
  }, [folderId, folderLeadIds, router.query]);

  const { id } = router.query;

  const [lead, setLead] = useState<Lead | null>(null);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [historyLines, setHistoryLines] = useState<string[]>([]);
  const [noteLines, setNoteLines] = useState<DisplayNote[]>([]);
  const [showNoteComposer, setShowNoteComposer] = useState(false);
  const [memoryProfile, setMemoryProfile] = useState<LeadMemoryProfileView | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [callsLoading, setCallsLoading] = useState(false);
  const [showSmsPanel, setShowSmsPanel] = useState(false);

  const userHasAI = true;

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<UICampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [startAtLocal, setStartAtLocal] = useState<string>("");
  const [enrolling, setEnrolling] = useState(false);

  const [unenrollOpen, setUnenrollOpen] = useState(false);
  const [activeDripIds, setActiveDripIds] = useState<string[]>([]);
  const [activeDripsLoading, setActiveDripsLoading] = useState(false);
  const [removeCampaignId, setRemoveCampaignId] = useState<string>("");
  const [removing, setRemoving] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingLead, setDeletingLead] = useState(false);

  // ✅ Live edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<string>("");
  const [editingValue, setEditingValue] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [fieldEditingEnabled, setFieldEditingEnabled] = useState(false);

  const formatPhone = (phone = "") => {
    const clean = String(phone).replace(/\D/g, "");
    if (clean.length === 10) return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
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
    const r = await fetch(`/api/get-lead?id=${encodeURIComponent(lookup)}`, { cache: "no-store" });
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

      const digits = idStr.replace(/\D+/g, "");
      if (digits.length >= 10) {
        const r = await fetch(`/api/get-lead?phone=${encodeURIComponent(idStr)}`, { cache: "no-store" });
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
      const r = await fetch(`/api/leads/history?id=${encodeURIComponent(key)}&limit=50`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Failed to load history");

      const lines: string[] = [];
      const savedNotes: DisplayNote[] = [];
      (j.events || []).forEach((ev: HistoryEvent) => {
        if (ev.type === "note") {
          const text = sanitizeLeadNoteForDisplay(ev.text);
          if (!text) return;
          savedNotes.push({ id: ev.id, text, date: ev.date });
          lines.push(`📝 ${text} • ${fmtDateTime(ev.date)}`);
        } else if (ev.type === "sms") {
          const dir = ev.dir === "inbound" ? "⬅️ Inbound SMS" : ev.dir === "outbound" ? "➡️ Outbound SMS" : "🤖 AI SMS";
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
      setNoteLines(savedNotes);
    } catch (e) {
      console.error(e);
    } finally {
      setHistLoading(false);
    }
  }, [resolvedId, id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!resolvedId) {
      setMemoryProfile(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const r = await fetch(`/api/ai/memory/profile?leadId=${encodeURIComponent(resolvedId)}`, {
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok || cancelled) return;
        setMemoryProfile(j?.profile || null);
      } catch {
        if (!cancelled) setMemoryProfile(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resolvedId]);

  const loadCalls = useCallback(async () => {
    if (!resolvedId) return;
    try {
      setCallsLoading(true);
      const r = await fetch(`/api/calls?leadId=${encodeURIComponent(resolvedId)}`, { cache: "no-store" });
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
          (Array.isArray(c.aiActionItems) && c.aiActionItems.length > 0),
      ) ||
      null
    );
  }, [calls]);

  const latestCallNeedingOverview = useMemo(() => {
    const sorted = calls.slice().sort((a, b) => {
      const da = new Date(a.startedAt || a.completedAt || 0).getTime();
      const db = new Date(b.startedAt || b.completedAt || 0).getTime();
      return db - da;
    });

    return (
      sorted.find((c: any) => {
        const hasRecording = !!c?.hasRecording || !!c?.recordingSid || !!c?.recordingUrl;
        const ready = !!c?.aiOverviewReady;
        return hasRecording && !ready;
      }) || null
    );
  }, [calls]);

  const latestRecordedCall = useMemo(() => calls
    .slice()
    .sort((a, b) => new Date(b.startedAt || b.completedAt || 0).getTime() - new Date(a.startedAt || a.completedAt || 0).getTime())
    .find((call) => call.hasRecording || call.recordingUrl) || null, [calls]);


  const closeOverview = useMemo(() => {
    const c = latestOverviewCall as any;
    if (!c) return null;

    const o = c?.aiOverview;

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

    const legacyBullets = Array.isArray(c.aiBullets) ? c.aiBullets : [];
    const legacyActions = Array.isArray(c.aiActionItems) ? c.aiActionItems : [];

    return {
      overviewBullets: legacyBullets.length ? safeBullets(legacyBullets, 6) : c.aiSummary ? [String(c.aiSummary)] : [],
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

  const handleSaveNote = async () => {
    const cleanNote = sanitizeLeadNoteForDisplay(notes);
    if (!cleanNote || !lead?.id) return toast.error("❌ Cannot save an empty note");
    try {
      const r = await fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, type: "note", message: cleanNote }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message || "Failed to save note");
      }
      const savedAt = new Date();
      const savedNote: DisplayNote = {
        id: `local-${savedAt.getTime()}`,
        text: cleanNote,
        date: savedAt.toISOString(),
      };
      setHistoryLines((prev) => [`📝 ${savedNote.text} • ${fmtDateTime(savedNote.date)}`, ...prev]);
      setNoteLines((prev) => [savedNote, ...prev]);
      setNotes("");
      setShowNoteComposer(false);
      toast.success("✅ Note saved!");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save note");
    }
  };

  const handleDeleteLead = async () => {
    if (!lead?.id) return;
    try {
      setDeletingLead(true);
      const r = await fetch('/api/leads/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j?.message || 'Failed to delete lead');
      toast.success('Lead deleted');
      window.location.href = LEADS_URL;
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete lead');
      setDeletingLead(false);
    }
  };

  // ---------- Inline calling (NO /dial-session) ----------
  // Voicemail drop state
  const [vmDrops, setVmDrops] = useState<{ _id: string; name: string; audioUrl?: string }[]>([]);
  const [vmDropping, setVmDropping] = useState(false);
  const [vmDropStatus, setVmDropStatus] = useState<string>("");
  const [vmDropOpen, setVmDropOpen] = useState(false);


  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [selectedFromNumber, setSelectedFromNumber] = useState<string>("");

  const { status: callStatus, callActive, muted, startCall: startInlineCall, hangup, toggleMute } = useInlineLeadCall();

  useEffect(() => {
    const loadNumbers = async () => {
      try {
        const r = await fetch("/api/getNumbers");
        const j = await r.json().catch(() => ({} as any));
        const list: NumberEntry[] = Array.isArray(j?.numbers) ? j.numbers : [];
        setNumbers(list);
        // default selection: previously selected dial number OR first number
        try {
          const saved = typeof window !== "undefined" ? window.localStorage.getItem("selectedDialNumber") : "";
          const candidate = saved && list.some((n) => String(n.phoneNumber) === String(saved)) ? saved : (list[0]?.phoneNumber || "");
          if (candidate) setSelectedFromNumber(String(candidate));
        } catch {
          if (list[0]?.phoneNumber) setSelectedFromNumber(String(list[0].phoneNumber));
        }
      } catch {
        setNumbers([]);
      }
    };
    loadNumbers();
  }, []);

  const startCall = async () => {
    if (!lead?.id) return toast.error("Lead not loaded");
    await startInlineCall({ leadId: lead.id, fromNumber: selectedFromNumber });
  };

  // Load voicemail drops when needed
  const loadVmDrops = async () => {
    try {
      const r = await fetch("/api/voicemail");
      const j = await r.json();
      setVmDrops(j.drops || []);
    } catch {}
  };

  const doVmDrop = async (dropId?: string) => {
    if (!lead) return;
    const phone = lead.Phone || lead.phone || (lead as any)["Phone Number"];
    if (!phone) { toast.error("No phone number on this lead"); return; }
    setVmDropping(true);
    setVmDropStatus("");
    try {
      const res = await fetch("/api/voicemail/drop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toPhone: phone, dropId, leadId: lead.id }),
      });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || "Failed to drop voicemail"); return; }
      setVmDropStatus("✓ Voicemail dropped");
      setTimeout(() => setVmDropStatus(""), 3000);
      setVmDropOpen(false);
      toast.success("Voicemail drop initiated");
    } catch {
      toast.error("Network error");
    } finally {
      setVmDropping(false);
    }
  };

  const handleVmDropClick = async () => {
    await loadVmDrops();
    if (vmDrops.length === 0) {
      toast.error("No voicemail drops set up. Go to Settings → Voicemail Drops to add one.");
      return;
    }
    if (vmDrops.length === 1) {
      await doVmDrop(vmDrops[0]._id);
    } else {
      setVmDropOpen(true);
    }
  };


  const leadInfoRows = useMemo(() => {
    const l = lead || ({} as any);
    const flat = flattenDisplayFields(l);

    const mapNormToKeys: Record<string, string[]> = {};
    Object.keys(flat).forEach((k) => {
      const nk = normalizeKey(k);
      if (!mapNormToKeys[nk]) mapNormToKeys[nk] = [];
      mapNormToKeys[nk].push(k);
    });

    const getByAliases = (aliases: string[]) => {
      for (const a of aliases) {
        const nk = normalizeKey(a);
        const keys = mapNormToKeys[nk];
        if (!keys || !keys.length) continue;
        for (const realKey of keys) {
          const rendered = formatDisplayValue(flat[realKey]);
          if (rendered) return { key: realKey, value: rendered };
        }
      }
      return null;
    };

    const usedNorm = new Set<string>();
    const rows: { label: string; key: string; value: string; editable: boolean }[] = [];

    const pushField = (label: string, aliases: string[], transform?: (v: string) => string) => {
      const found = getByAliases(aliases);
      if (!found) return;
      const nk = normalizeKey(found.key);
      if (usedNorm.has(nk)) return;

      const v = transform ? transform(found.value) : found.value;
      if (!v) return;

      usedNorm.add(nk);
      rows.push({ label, key: found.key, value: v, editable: true });
    };

    pushField("First Name", ["First Name", "firstName", "first name", "First name", "FName", "Given Name"]);
    pushField("Last Name", ["Last Name", "lastName", "last name", "Last name", "LName", "Surname"]);

    if (!rows.find((r) => r.label === "First Name") && !rows.find((r) => r.label === "Last Name")) {
      pushField("Name", ["Name", "name", "Full Name", "fullName"]);
    }

    pushField("Phone", ["Phone", "phone", "Phone Number", "phoneNumber", "Mobile", "Cell", "Home", "Work", "Other Phone 1"], formatPhone);
    pushField("Email", ["Email", "email", "Email Address"]);
    pushField("Status", ["Status", "status"]);

    pushField("DOB", ["DOB", "Date Of Birth", "Birthday", "birthdate", "Birth Date", "Date of birth"]);
    pushField("Age", ["Age", "age"], (value) => value === "0" ? "—" : value);

    pushField("Street Address", ["Street Address", "street", "street address", "Address", "address", "Address 1"]);
    pushField("City", ["City", "city"]);
    pushField("State", ["State", "state", "ST", "RR State", "RRState"]);
    pushField("Zip", ["Zip", "ZIP", "ZIP code", "Zip code", "postal", "postalCode"]);

    pushField("Mortgage Amount", ["Mortgage Amount", "mortgage amount", "Mortgage Balance", "mortgage balance", "Mortgage", "mortgage"]);
    pushField("Mortgage Payment", ["Mortgage Payment", "mortgage payment"]);
    pushField(
      "Coverage Amount",
      ["Coverage Amount", "coverageAmount", "coverage", "How Much Coverage Do You Need?"],
      (value) => value === "0" ? "—" : value,
    );

    pushField("Lender", ["Lender", "lender"]);
    pushField("County", ["County", "county"]);
    pushField("Beneficiary", ["Beneficiary", "beneficiary"]);
    pushField("Beneficiary Name", ["Beneficiary Name", "beneficiary name"]);

    const hardBlockNorm = new Set<string>([
      "_id",
      "id",
      "userid",
      "ownerid",
      "useremail",
      "folderid",
      "assigneddrips",
      "dripprogress",
      "createdat",
      "updatedat",
      "__v",
      "history",
      "interactionhistory",
      "phonelast10",
      "normalizedphone",
      "rawrow",
      "leadtype",
      "reminderssent",
      "isaiengaged",
      "v",
      // Internal scoring/AI flags — not useful to agents
      "scorebreakdown",
      "aiconversationactive",
      "scoreversion",
      "scoreupdatedat",
      "sheetmeta",
      "sourcetype",
      "realtimeeligible",
      "aifirstcallattempteat",
      "aifirstcallattemptdat",
      "aifirstcalldueat",
      "aifirstcallstatus",
      "donotcall",
      "donotcallat",
      "appointmenttime",
      "aifirstcallattemptedat",
      "aifirstcalltriggeredat",
      "aiprioritycategory",
      "aipriorityscore",
      "externalid",
      "source",
      "status",
    ]);

    const alreadyUsedAliasesNorm = new Set<string>();
    rows.forEach((r) => alreadyUsedAliasesNorm.add(normalizeKey(r.key)));

    const extras = Object.entries(flat)
      .filter(([k, v]) => {
        const nk = normalizeKey(k);

        if (!k) return false;
        if (hardBlockNorm.has(nk)) return false;
        if (looksLikeSystemKey(k)) return false;
        if (looksLikeNotesKey(k)) return false;

        if (usedNorm.has(nk)) return false;
        if (alreadyUsedAliasesNorm.has(nk)) return false;

        const rendered = formatDisplayValue(v);
        if (!rendered) return false;

        const lower = rendered.toLowerCase();
        if (lower.includes("[ai dialer fallback]")) return false;
        if (lower.includes("callsid=") && lower.includes("twilio status")) return false;

        return true;
      })
      .map(([k, v]) => ({
        label: labelFromKey(k),
        key: k,
        value: formatDisplayValue(v),
        editable: true,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [...rows, ...extras];
  }, [lead]);

  const leadName = useMemo(() => {
    const l = lead || ({} as any);
    const flat = flattenDisplayFields(l);

    const first =
      formatDisplayValue(flat["First Name"]) ||
      formatDisplayValue(flat["firstName"]) ||
      formatDisplayValue(flat["First name"]) ||
      formatDisplayValue(flat["first name"]);

    const last =
      formatDisplayValue(flat["Last Name"]) ||
      formatDisplayValue(flat["lastName"]) ||
      formatDisplayValue(flat["Last name"]) ||
      formatDisplayValue(flat["last name"]);

    const full = `${first} ${last}`.replace(/\s+/g, " ").trim();
    if (full) return full;

    const name = formatDisplayValue(flat["Name"]) || formatDisplayValue(flat["name"]);
    return name || lead?.name || "Lead";
  }, [lead]);

  const openEditor = useCallback(
    (fieldKey: string, label: string, currentValue: any) => {
      if (!lead?.id) return;

      if (looksLikeSystemKey(fieldKey)) return;
      if (looksLikeNotesKey(fieldKey)) return;

      const nk = normalizeKey(fieldKey);
      if (nk === "rawrow" || nk === "reminderssent" || nk === "v") return;

      setEditingKey(fieldKey);
      setEditingLabel(label);
      setEditingValue(String(currentValue ?? "").trim());
    },
    [lead],
  );

  const closeEditor = () => {
    setEditingKey(null);
    setEditingLabel("");
    setEditingValue("");
  };

  const saveEdit = useCallback(async () => {
    if (!lead?.id || !editingKey) return;
    try {
      setSavingEdit(true);

      const r = await fetch("/api/update-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, field: editingKey, value: editingValue }),
      });

      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(j?.message || "Failed to update");

      setLead((prev) => {
        if (!prev) return prev;
        return { ...prev, [editingKey]: editingValue };
      });

      toast.success("✅ Updated");
      closeEditor();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update");
    } finally {
      setSavingEdit(false);
    }
  }, [lead, editingKey, editingValue]);

  // ---------- Campaigns list ----------
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

  const loadActiveForLead = useCallback(async () => {
    if (!resolvedId) return;
    try {
      setActiveDripsLoading(true);

      const resp = await fetch(`/api/drips/enrollments?leadId=${encodeURIComponent(resolvedId)}`, { cache: "no-store" });
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

  useEffect(() => {
    loadActiveForLead();
  }, [loadActiveForLead]);

  const campaignNameById = useCallback(
    (id: string) => campaigns.find((c) => String(c._id) === String(id))?.name || id,
    [campaigns],
  );

  const openEnrollModal = () => {
    if (!resolvedId) return toast.error("Lead not loaded");
    setEnrollOpen(true);
  };

  const openUnenrollModal = async () => {
    if (!resolvedId) return toast.error("Lead not loaded");
    await loadActiveForLead();
    setUnenrollOpen(true);
  };

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

      const enrolledName = j?.campaign?.name || campaigns.find((c) => c._id === selectedCampaignId)?.name || "campaign";
      setHistoryLines((prev) => [`🔖 Status: Enrolled to ${enrolledName} • ${new Date().toLocaleString()}`, ...prev]);

      toast.success(`✅ Enrolled in ${enrolledName}`);
      setEnrollOpen(false);
      setSelectedCampaignId("");
      setStartAtLocal("");
      await loadActiveForLead();
    } catch (e: any) {
      toast.error(e?.message || "Enrollment failed");
    } finally {
      setEnrolling(false);
    }
  };

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
      await loadActiveForLead();
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove");
    } finally {
      setRemoving(false);
    }
  };

  // ✅ Styling-only change: make rows look like Dial Session left panel
  const LeadInfoRow = ({
    label,
    value,
    fieldKey,
    editable = true,
  }: {
    label: string;
    value: string;
    fieldKey?: string;
    editable?: boolean;
  }) => {
    const v = String(value || "").trim();
    const canEdit = fieldEditingEnabled && !!fieldKey && editable;

    const content = (
      <>
        <p className="flex items-start justify-between gap-3 text-sm text-white">
          <strong className="shrink-0 text-gray-300">{label}</strong>
          <span className="min-w-0 break-words text-right text-white">{v || "—"}</span>
        </p>
        <hr className="my-2 border-gray-700/70" />
      </>
    );

    return canEdit ? (
      <button
        type="button"
        onClick={() => openEditor(fieldKey!, label, value)}
        className="w-full rounded px-1 text-left transition hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        aria-label={`Edit ${label}`}
      >
        {content}
      </button>
    ) : (
      <div className="px-1">{content}</div>
    );
  };


  // ---------- Disposition (move lead to folder) ----------
  const [disposition, setDisposition] = useState<string>("");
  const [savingDisposition, setSavingDisposition] = useState<boolean>(false);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [defaultComp, setDefaultComp] = useState(100);

  const handleDispositionChange = async (value: string) => {
    setDisposition(value);
    const v = String(value || "").trim();
    if (!v) return;

    // Intercept Sold → show SaleModal before committing disposition
    if (v === "Sold") {
      setShowSaleModal(true);
      return;
    }

    // Match existing behavior elsewhere: disposition endpoint ignores No Answer for folder moves.

    const leadId = String(lead?._id || lead?.id || router.query.id || "").trim();
    if (!leadId) {
      toast.error("Lead not loaded");
      return;
    }

    try {
      setSavingDisposition(true);

      const res = await fetch("/api/disposition-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, newFolderName: v }),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to move lead");
      }

      toast.success(`Moved to ${data?.folderName || v}`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to move lead");
    } finally {
      setSavingDisposition(false);
    }
  };

  const legacyLeadNote = sanitizeLeadNoteForDisplay(lead?.notes || lead?.Notes || "");
  const visibleLegacyLeadNote = /^source\s*:/i.test(legacyLeadNote) ? "" : legacyLeadNote;
  const savedNoteCount = noteLines.length + (visibleLegacyLeadNote ? 1 : 0);


  // ---------- Render ----------
  return (
    <div className="cove-app-shell flex bg-[#0f172a] text-white min-h-screen">
      <Sidebar collapsed />

      <main className="min-w-0 flex-1">
      <div className="grid min-h-[calc(100vh-1px)] grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(280px,320px)] xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)_minmax(300px,380px)]">

      {/* LEFT */}
      <div className="overflow-y-auto border-b border-gray-800 bg-[#1e293b] p-4 md:col-span-2 xl:col-span-1 xl:border-b-0 xl:border-r">
        {/* VERIFICATION MARKER: search this in prod to confirm correct build */}
        <div className="hidden">LEAD_INFO_LEFT_PANEL_DIALSESSION_STYLE_V2</div>

        <div className="mb-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-bold">{leadName}</h2>
            <button
              type="button"
              onClick={() => setFieldEditingEnabled((enabled) => !enabled)}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                fieldEditingEnabled
                  ? "border-blue-500 bg-blue-600 text-white"
                  : "border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
              }`}
            >
              {fieldEditingEnabled ? "Done" : "Edit profile"}
            </button>
          </div>

          <div className="mt-1 space-y-1">
            <div className="text-xs text-gray-400">
              {fieldEditingEnabled ? "Select a field to edit it." : "Contact details and lead context."}
            </div>

            <div className="text-xs text-gray-300 flex flex-wrap gap-x-3 gap-y-1">
              <span>
                Lead Score:{" "}
                <span className="text-white font-semibold">
                  {typeof (lead as any)?.score === "number" ? (lead as any).score : "—"}
                </span>
              </span>

              <span>
                Best Time to Call:{" "}
                <span className="text-white font-semibold">
                  {(lead as any)?.bestTimeToCall || "—"}
                </span>
              </span>

              <span className="text-gray-400">
                {(lead as any)?.realTimeEligible === true
                  ? "Realtime Lead"
                  : (lead as any)?.realTimeEligible === false
                  ? "Imported / Non-realtime Lead"
                  : ""}
              </span>
            </div>
          </div>

          <hr className="border-gray-700 my-2" />
        </div>

        {/* ✅ Removed the inner black “card/box” entirely — render like Dial Session */}
        <div>
          {leadInfoRows.length ? (
            <>
              {leadInfoRows.slice(0, 8).map((r) => (
                <LeadInfoRow
                  key={`${r.label}-${r.key}`}
                  label={r.label}
                  value={r.value}
                  fieldKey={r.key}
                  editable={r.editable}
                />
              ))}
              {leadInfoRows.length > 8 && (
                <details className="mt-3 rounded-lg border border-white/10 bg-[#0f172a]/40 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-300">
                    Additional details ({leadInfoRows.length - 8})
                  </summary>
                  <div className="mt-3">
                    {leadInfoRows.slice(8).map((r) => (
                      <LeadInfoRow
                        key={`${r.label}-${r.key}`}
                        label={r.label}
                        value={r.value}
                        fieldKey={r.key}
                        editable={r.editable}
                      />
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-400 py-2">No lead fields found.</div>
          )}
        </div>
      </div>

      {/* CENTER */}
      <div className="flex min-h-0 flex-col border-b border-gray-800 bg-[#0f172a] p-5 sm:p-6 xl:border-b-0 xl:border-r">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-lg font-bold">Lead Workspace</h3>
              <p className="text-xs text-gray-400">Call, text, update disposition, and review activity.</p>
            </div>
            {folderId ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => prevLeadId && router.push(`/lead/${prevLeadId}?folderId=${encodeURIComponent(folderId)}`)}
                  disabled={!prevLeadId}
                  className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40"
                  title={folderLeadIdsLoading ? "Loading…" : "Previous lead"}
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => nextLeadId && router.push(`/lead/${nextLeadId}?folderId=${encodeURIComponent(folderId)}`)}
                  disabled={!nextLeadId}
                  className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40"
                  title={folderLeadIdsLoading ? "Loading…" : "Next lead"}
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>

          {/* Call row (NO /dial-session) */}
          <div className="mt-4 flex items-center gap-2 mb-2 flex-wrap">
            <select
              value={selectedFromNumber}
              onChange={(e) => setSelectedFromNumber(e.target.value)}
              className="text-sm bg-[#1e293b] text-white border border-white/10 rounded px-2 py-1.5 min-w-[220px]"
              disabled={!numbers.length}
              title="Select number to call from"
            >
              {numbers.length ? null : <option value="">No numbers</option>}
              {numbers.map((n) => (
                <option key={n.sid || n.id || n.phoneNumber} value={n.phoneNumber}>
                  {formatPhone(n.phoneNumber)}{getNumberState(n.phoneNumber) ? ` · ${getNumberState(n.phoneNumber)}` : ""}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={callActive ? () => hangup("agent-hangup") : startCall}
              disabled={!lead?.id || (!selectedFromNumber && !callActive)}
              className={`text-sm text-white px-3 py-1.5 rounded-md ${
                callActive ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
              } disabled:opacity-50`}
            >
              {callActive ? "Hang Up" : "Call"}
            </button>

            <button
              type="button"
              onClick={() => setShowSmsPanel((v) => !v)}
              className="text-sm bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md"
            >
              {showSmsPanel ? "Close Text" : "Text"}
            </button>

            <button
              type="button"
              onClick={toggleMute}
              disabled={!callActive}
              className="text-sm bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-md disabled:opacity-40"
              title="Mute/unmute"
            >
              {muted ? "Unmute" : "Mute"}
            </button>

            <span className="text-xs text-gray-400">
              {callStatus && callStatus !== "Idle" ? `Status: ${callStatus}` : null}
            </span>
          </div>

          {/* Drip actions */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {activeDripsLoading ? (
              <span className="text-xs text-gray-500">Checking drip enrollment…</span>
            ) : activeDripIds.length > 0 ? (
              <button
                type="button"
                onClick={openUnenrollModal}
                disabled={!lead?.id}
                className="text-sm bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 px-3 py-1.5 rounded-md"
              >
                Remove from Drip
              </button>
            ) : (
              <button
                type="button"
                onClick={openEnrollModal}
                disabled={!lead?.id}
                className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 px-3 py-1.5 rounded-md"
              >
                Enroll in Drip
              </button>
            )}
          </div>

          {showSmsPanel && lead?._id && (
            <div style={{
              marginBottom: 24,
              border: "1px solid #334155",
              borderRadius: 8,
              overflow: "hidden",
              height: 480
            }}>
              <ChatThread
                leadId={String(lead._id)}
                socket={getSocket()}
                mode="sms"
              />
            </div>
          )}


          {/* Disposition */}
          <div className="mb-4">
            <label className="block text-xs text-gray-300 mb-1">Disposition</label>
            <select
              value={disposition}
              disabled={savingDisposition || !lead?.id}
              onChange={(e) => handleDispositionChange(e.target.value)}
              className="w-full bg-[#1e293b] text-white border border-white/10 rounded p-2 disabled:opacity-60"
            >
              <option value="">-- Select Disposition --</option>
              <option value="Sold">Sold</option>
              <option value="Booked Appointment">Booked Appointment</option>
              <option value="Not Interested">Not Interested</option>
              <option value="Bad Number">Bad Number</option>
              <option value="No Answer">No Answer</option>
              <option value="No Show">No Show</option>
              <option value="Do Not Contact">Do Not Contact</option>
            </select>
            {lead?.status === "Sold" && (
              <button
                type="button"
                onClick={() => setShowSaleModal(true)}
                className="mt-1 text-xs text-blue-400 hover:text-blue-300"
              >
                Edit Sale Details
              </button>
            )}
          </div>

          {/* AI Call Overview */}
          {/* AI Call Overview */}
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
              <p className="text-gray-400 text-sm">{latestCallNeedingOverview ? "The latest recording is being processed automatically when AI Call Insights is enabled." : "No AI call overview yet for this lead."}</p>
            ) : !closeOverview ? (
              <p className="text-gray-400 text-sm">AI call found, but overview data is missing.</p>
            ) : (
              <div className="mt-2 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${outcomeBadgeClasses(closeOverview.outcome)}`}>
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

                <div className="text-xs text-gray-500 pt-1">
                  Based on most recent AI call •{" "}
                  {fmtDateTime((latestOverviewCall as any)?.startedAt || (latestOverviewCall as any)?.completedAt)}
                  {closeOverview.generatedAt ? <> • Overview generated {fmtDateTime(closeOverview.generatedAt)}</> : null}
                </div>
              </div>
            )}
          </div>

          {latestRecordedCall ? <CallCoachReport callId={String(latestRecordedCall.id)} /> : null}

          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold mb-2">Interaction History</h3>
            {histLoading ? <span className="text-xs text-gray-400">Loading…</span> : null}
          </div>

          <div className="max-h-[320px] min-h-[120px] overflow-y-auto rounded border border-white/10 bg-[#0b1220] p-3">
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

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              onClick={() => {
                try {
                  router.replace(LEADS_URL);
                } catch {
                  if (typeof window !== "undefined") window.location.replace(LEADS_URL);
                }
              }}
              className="rounded border border-white/10 bg-white/10 px-4 py-2 text-white hover:bg-white/20"
            >
              Back to Leads
            </button>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded px-3 py-2 text-sm text-gray-400 hover:bg-white/5 hover:text-white">
                More actions
              </summary>
              <div className="absolute bottom-full right-0 z-20 mb-2 w-40 rounded-lg border border-white/10 bg-[#111827] p-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={!lead?.id}
                  className="w-full rounded px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Delete lead
                </button>
              </div>
            </details>
          </div>
        </div>
      </div>

      {/* RIGHT: NOTES */}
      <aside className="flex min-h-0 flex-col bg-[#0b1220] p-4 sm:p-5" aria-labelledby="lead-notes-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="lead-notes-heading" className="text-lg font-bold">Notes</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {savedNoteCount} saved note{savedNoteCount === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNoteComposer((open) => !open)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            {showNoteComposer ? "Cancel" : "+ Add Note"}
          </button>
        </div>

        {showNoteComposer && (
          <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/5 p-3">
            <label htmlFor="lead-note" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-blue-200">
              New note
            </label>
            <textarea
              id="lead-note"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-28 w-full resize-y rounded-lg border border-white/10 bg-[#0f172a] p-3 text-sm text-white outline-none transition placeholder:text-gray-600 focus:border-blue-500"
              placeholder="Type a note about this lead..."
              autoFocus
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setNotes("");
                  setShowNoteComposer(false);
                }}
                className="rounded-md px-3 py-1.5 text-sm text-gray-400 transition hover:bg-white/5 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveNote}
                disabled={!sanitizeLeadNoteForDisplay(notes) || !lead?.id}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save Note
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex-1 space-y-2 overflow-y-auto pr-1">
          {visibleLegacyLeadNote && (
            <div className="rounded-xl border border-white/10 bg-[#111827] p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
                {visibleLegacyLeadNote}
              </p>
              <p className="mt-2 text-[11px] text-gray-500">Lead note</p>
            </div>
          )}
          {noteLines.map((note) => (
            <article key={note.id} className="rounded-xl border border-white/10 bg-[#111827] p-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200">{note.text}</p>
              <time dateTime={note.date} className="mt-2 block text-[11px] text-gray-500">
                {fmtDateTime(note.date)}
              </time>
            </article>
          ))}
          {savedNoteCount === 0 && (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
              <p className="text-sm text-gray-400">No notes yet</p>
              <p className="mt-1 text-xs text-gray-600">Add context, follow-up details, or reminders here.</p>
            </div>
          )}
        </div>
      </aside>
      </div>

      {/* CALLS & RECORDINGS */}
      <section className="border-t border-gray-800 bg-[#0b1220] px-4 py-5 sm:px-6" aria-labelledby="lead-recordings-heading">
        <div className="mx-auto max-w-7xl">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="lead-recordings-heading" className="text-lg font-bold">Calls &amp; Recordings</h3>
              <p className="mt-0.5 text-xs text-gray-500">Call history and playable recordings for this lead.</p>
            </div>
            {calls.length > 0 && (
              <p className="text-xs text-gray-500">
                {calls.length} call{calls.length === 1 ? "" : "s"} on file
              </p>
            )}
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0f172a] p-3 sm:p-4">
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
      </section>
      </main>

      {/* ✅ Live Edit Modal */}
      {editingKey ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={savingEdit ? undefined : closeEditor} />
          <div className="relative w-full max-w-md mx-4 rounded-lg border border-white/10 bg-[#0f172a] p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold">Edit Field</h3>
              <button onClick={savingEdit ? undefined : closeEditor} className="text-gray-300 hover:text-white">
                ✕
              </button>
            </div>

            <div className="text-sm text-gray-300 mb-2">{editingLabel}</div>

            <input
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              className="w-full bg-[#1e293b] text-white border border-white/10 rounded p-2"
              placeholder="Enter value…"
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={closeEditor}
                disabled={savingEdit}
                className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={savingEdit}
                className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50"
              >
                {savingEdit ? "Saving…" : "Save"}
              </button>
            </div>

            <div className="text-xs text-gray-500 mt-2">Updates are saved instantly and only apply to your lead records.</div>
          </div>
        </div>
      ) : null}

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
                  <option value="">{campaignsLoading ? "Loading…" : "-- Select a campaign --"}</option>
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
                <p className="text-xs text-gray-500 mt-1">Leave blank to start immediately; scheduler will handle timing.</p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setEnrollOpen(false)} className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600">
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

      {/* Delete Confirm Modal */}
      {deleteConfirmOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={deletingLead ? undefined : () => setDeleteConfirmOpen(false)} />
          <div className="relative w-full max-w-sm mx-4 rounded-lg border border-white/10 bg-[#0f172a] p-4 shadow-xl">
            <h3 className="text-lg font-bold mb-2">Delete Lead?</h3>
            <p className="text-sm text-gray-300 mb-4">
              <strong>{leadName}</strong> will be permanently removed. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setDeleteConfirmOpen(false)} disabled={deletingLead}
                className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleDeleteLead} disabled={deletingLead}
                className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {deletingLead ? 'Deleting…' : 'Delete'}
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
                <p className="text-xs text-gray-500 mt-1">Only campaigns this lead is currently enrolled in are shown.</p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setUnenrollOpen(false)} className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600">
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

      {showSaleModal && lead && (
        <SaleModal
          leadId={String(lead._id || lead.id || "")}
          defaultComp={defaultComp}
          existingAP={lead.annualPremium ? Number(lead.annualPremium) : undefined}
          existingComp={lead.compPercentage ? Number(lead.compPercentage) : undefined}
          onSave={async (result) => {
            setShowSaleModal(false);
            try {
              await fetch("/api/leads/record-sale", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId: lead._id || lead.id, ...result }),
              });
              // now commit the disposition
              const leadId = String(lead._id || lead.id || "").trim();
              setSavingDisposition(true);
              const res = await fetch("/api/disposition-lead", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId, newFolderName: "Sold" }),
              });
              const data = await res.json().catch(() => ({} as any));
              if (!res.ok || !data?.success) throw new Error(data?.message || "Failed to move lead");
              toast.success(`Moved to ${data?.folderName || "Sold"}`);
            } catch (e: any) {
              toast.error(e?.message || "Failed to save sale");
            } finally {
              setSavingDisposition(false);
              setDisposition("");
            }
          }}
          onMarkPending={async () => {
            setShowSaleModal(false);
            const leadId = String(lead._id || lead.id || "").trim();
            setSavingDisposition(true);
            try {
              const res = await fetch("/api/disposition-lead", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId, newFolderName: "Sold", premiumPending: true }),
              });
              const data = await res.json().catch(() => ({} as any));
              if (!res.ok || !data?.success) throw new Error(data?.message || "Failed to move lead");
              toast.success(`Moved to ${data?.folderName || "Sold"} — premium pending`);
            } catch (e: any) {
              toast.error(e?.message || "Failed to mark lead as Sold");
            } finally {
              setSavingDisposition(false);
              setDisposition("");
            }
          }}
          onCancel={() => { setShowSaleModal(false); setDisposition(""); }}
        />
      )}
    </div>
  );
}
