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

type UICampaign = {
  _id: string;
  name: string;
  key?: string;
  isActive?: boolean;
  active?: boolean;
};

const LEADS_URL = "/dashboard?tab=leads";

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

function isEmptyValue(v: any) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  return false;
}

function formatDisplayValue(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";

  // For UI sanity: do NOT render objects/arrays as big blobs in the left panel.
  // If it's structured data, skip it and keep left panel "legit CRM style".
  return "";
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

    // common internal / computed
    "phonelast10",
    "normalizedphone",
    "isaiengaged",
    "reminderssent",
    "rawrow",
    "source",
    "v",
  ]);

  if (blockedExact.has(nk)) return true;
  return false;
}

function flattenDisplayFields(lead: any) {
  const out: Record<string, any> = {};
  if (!lead || typeof lead !== "object") return out;

  Object.keys(lead).forEach((k) => {
    out[k] = lead[k];
  });

  // if any import stored under nested containers, expose them for UI (display-only)
  const candidates = ["customFields", "fields", "data", "sheet", "payload"];
  for (const c of candidates) {
    const obj = lead?.[c];
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      Object.keys(obj).forEach((k) => {
        if (out[k] === undefined) out[k] = obj[k];
      });
    }
  }

  return out;
}

function isScalarDisplayable(v: any) {
  if (v === null || v === undefined) return false;
  const t = typeof v;
  if (t === "string") {
    const s = v.trim();
    if (!s) return false;

    // kill giant blobs / JSON-ish strings
    if (s.length > 220) return false;
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) return false;
    if (s.includes("[AI Dialer fallback]")) return false;

    return true;
  }
  if (t === "number" || t === "boolean") return true;
  return false;
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

  // ✅ Live edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<string>("");
  const [editingValue, setEditingValue] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);

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
      (j.events || []).forEach((ev: any) => {
        const e = ev as HistoryEvent;
        if (e.type === "note") {
          lines.push(`📝 ${e.text} • ${fmtDateTime(e.date)}`);
        } else if (e.type === "sms") {
          const dir =
            e.dir === "inbound" ? "⬅️ Inbound SMS" : e.dir === "outbound" ? "➡️ Outbound SMS" : "🤖 AI SMS";
          const status = e.status ? ` • ${e.status}` : "";
          lines.push(`${dir}: ${e.text}${status} • ${fmtDateTime(e.date)}`);
        } else if (e.type === "booking") {
          const title = e.title || "Booked Appointment";
          const when = e.startsAt ? fmtDateTime(e.startsAt) : fmtDateTime(e.date);
          lines.push(`📅 ${title} • ${when}`);
        } else if (e.type === "status") {
          lines.push(`🔖 Status: ${e.to || "Updated"} • ${fmtDateTime(e.date)}`);
        } else if (e.type === "ai_outcome") {
          const label = e.message || "🤖 AI Dialer outcome";
          lines.push(`🤖 ${label} • ${fmtDateTime(e.date)}`);
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
    if (!notes.trim() || !lead?.id) return toast.error("❌ Cannot save an empty note");
    try {
      const r = await fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, type: "note", message: notes.trim() }),
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

  const startCall = () => {
    if (!lead?.id) return toast.error("Lead not loaded");
    router.push({ pathname: "/dial-session", query: { leadId: lead.id } });
  };

  // Find best underlying key so edits update the real stored field
  const bestKeyFor = useCallback(
    (candidates: string[]) => {
      const l = lead || ({} as any);
      const flat = flattenDisplayFields(l);

      for (const k of candidates) {
        if (flat[k] !== undefined) return k;
        const target = normalizeKey(k);
        const found = Object.keys(flat).find((kk) => normalizeKey(kk) === target);
        if (found) return found;
      }
      return candidates[0];
    },
    [lead],
  );

  const openEditor = useCallback(
    (fieldKey: string, label: string, currentValue: any) => {
      if (!lead?.id) return;
      if (looksLikeSystemKey(fieldKey)) return;
      if (looksLikeNotesKey(fieldKey)) return;

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

      // optimistic UI update (only affects this page state)
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

  // ✅ One "CRM style" panel:
  // - Show prioritized important fields via synonym map
  // - Then show any remaining scalar imported fields (incl. user-created CSV "custom fields")
  // - Never show duplicates or junk/internal/blob keys
  const leftRows = useMemo(() => {
    const l = lead || ({} as any);
    const flat = flattenDisplayFields(l);

    // Build normalized map: normalizedKey -> { rawKey, value }
    const normMap = new Map<string, { rawKey: string; value: any }>();
    Object.keys(flat).forEach((k) => {
      normMap.set(normalizeKey(k), { rawKey: k, value: flat[k] });
    });

    const shownNormKeys = new Set<string>();
    const rows: { label: string; key: string; value: string; editable: boolean }[] = [];

    const pull = (label: string, candidates: string[], opts?: { format?: (v: any) => string }) => {
      for (const c of candidates) {
        const hit = normMap.get(normalizeKey(c));
        if (!hit) continue;

        const rawKey = hit.rawKey;
        const value = hit.value;

        if (looksLikeSystemKey(rawKey)) continue;
        if (looksLikeNotesKey(rawKey)) continue;
        if (!isScalarDisplayable(value)) continue;

        const formatted = opts?.format ? opts.format(value) : String(value).trim();
        if (!formatted) continue;

        const nk = normalizeKey(rawKey);
        shownNormKeys.add(nk);

        rows.push({
          label,
          key: rawKey,
          value: formatted,
          editable: true,
        });
        return;
      }
    };

    // IMPORTANT FIELD MAP (covers your header examples)
    pull("First Name", ["First Name", "First name", "firstName", "firstname", "First_Name"]);
    pull("Last Name", ["Last Name", "Last name", "lastName", "lastname", "Last_Name"]);
    pull("Name", ["Name", "name"], {
      format: (v) => String(v).replace(/\s+/g, " ").trim(),
    });

    pull("Phone", ["Phone", "Phone Number", "Phone number", "phone", "phoneNumber", "Mobile", "Home", "Work"], {
      format: (v) => formatPhone(String(v)),
    });

    pull("Email", ["Email", "email", "Email Address", "E-mail"]);

    pull("Lead Type", ["Lead Type", "Lead type", "leadType", "Lead vendor", "Lead Vendor", "vendor", "lead vendor"]);

    pull("Status", ["Status", "status"]);

    pull("DOB", ["DOB", "Date Of Birth", "Date of Birth", "Birthday", "birthdate", "Birth Date"]);
    pull("Age", ["Age", "age", "Client Age"]);
    pull("State", ["State", "state", "ST", "RR State", "RRState"]);
    pull("City", ["City", "city"]);
    pull("Zip", ["Zip", "ZIP", "ZIP code", "Zip code", "postal", "Postal Code"]);

    pull("Street Address", ["Street Address", "Street address", "address", "Address", "streetAddress"]);

    // Mortgage / Coverage (all your variants)
    pull("Mortgage Amount", [
      "Mortgage Amount",
      "mortgage amount",
      "Mortgage Balance",
      "mortgage balance",
      "Mortgage",
      "mortgage",
      "mortgageAmount",
      "MortgageAmount",
    ]);
    pull("Mortgage Payment", ["Mortgage Payment", "mortgage payment", "MortgagePayment", "mortgagePayment"]);
    pull("Coverage Amount", [
      "Coverage",
      "coverage",
      "Coverage Amount",
      "coverageAmount",
      "How Much Coverage Do You Need?",
      "Policy Amount",
      "Face Amount",
    ]);

    // After important rows, show remaining scalar imported fields (includes user-entered “custom fields”)
    // while hiding duplicates + junk + blobs.
    const remainder = Object.keys(flat)
      .filter((k) => {
        const nk = normalizeKey(k);
        if (shownNormKeys.has(nk)) return false;

        if (looksLikeSystemKey(k)) return false;
        if (looksLikeNotesKey(k)) return false;

        const v = flat[k];
        if (!isScalarDisplayable(v)) return false;

        // don’t show empty-ish
        const s = String(v).trim();
        if (!s) return false;

        return true;
      })
      .map((k) => ({
        key: k,
        label: String(k).replace(/_/g, " "),
        value: String(flat[k]).trim(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    remainder.forEach((f) => {
      rows.push({
        label: f.label,
        key: f.key,
        value: f.value,
        editable: true,
      });
    });

    // Name shown at top should be “best available”
    const nameTop = (() => {
      const first = rows.find((r) => r.label === "First Name")?.value || "";
      const last = rows.find((r) => r.label === "Last Name")?.value || "";
      const full = `${first} ${last}`.replace(/\s+/g, " ").trim();
      if (full) return full;

      const name = rows.find((r) => r.label === "Name")?.value || "";
      if (name) return name;

      return lead?.name || "Lead";
    })();

    return { nameTop, rows };
  }, [lead]);

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
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove");
    } finally {
      setRemoving(false);
    }
  };

  // ✅ compact rows: label + value close together (like your old UI)
  const CompactRow = ({
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
    const canEdit = !!fieldKey && editable;

    return (
      <button
        type="button"
        onClick={() => {
          if (!canEdit) return;
          openEditor(fieldKey!, label, value);
        }}
        className={`w-full text-left py-1 ${canEdit ? "hover:bg-white/5 rounded px-1 -mx-1" : ""}`}
      >
        <div className="flex items-baseline gap-2">
          <div className="text-[12px] text-gray-400 w-[130px] shrink-0">{label}</div>
          <div className="text-[13px] text-white break-words leading-snug">
            {v || "—"} {canEdit ? <span className="text-gray-500 text-[11px] ml-2">Edit</span> : null}
          </div>
        </div>
      </button>
    );
  };

  // ---------- Render ----------
  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen">
      <Sidebar />

      {/* LEFT */}
      <div className="w-[360px] p-4 border-r border-gray-800 bg-[#1e293b] overflow-y-auto">
        {/* VERIFICATION MARKER: search this in prod to confirm correct build */}
        <div className="hidden">LEAD_PROFILE_LEFT_PANEL_PRIORITY_FIELDS_V1</div>

        <div className="mb-3">
          <h2 className="text-xl font-bold">{leftRows.nameTop}</h2>
          <div className="text-xs text-gray-400 mt-1">Click any field to edit.</div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#0b1220]">
          <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
            <div className="text-sm font-semibold">Lead Info</div>
            <div className="text-xs text-gray-500">{leftRows.rows.length}</div>
          </div>
          <div className="px-3 py-2">
            {leftRows.rows.length ? (
              leftRows.rows.map((f) => (
                <CompactRow key={`${f.label}:${f.key}`} label={f.label} value={f.value} fieldKey={f.key} editable={f.editable} />
              ))
            ) : (
              <div className="text-sm text-gray-400 py-1">No fields found.</div>
            )}
          </div>
        </div>
      </div>

      {/* CENTER */}
      <div className="flex-1 p-6 bg-[#0f172a] border-r border-gray-800 flex flex-col min-h-0">
        <div className="max-w-3xl flex flex-col min-h-0 flex-1">
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
              <p className="text-gray-400 text-sm">No AI call overview yet for this lead.</p>
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
                    {activeDripsLoading ? "Loading…" : activeDripIds.length ? "-- Select a campaign --" : "No active drips"}
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
    </div>
  );
}
