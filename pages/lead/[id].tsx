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
  Notes?: string; // ← pinned notes come from here
  status?: string;
  folderId?: string | null;
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
  aiSentiment?: "positive" | "neutral" | "negative";
  hasAI?: boolean;
};

type HistoryEvent =
  | { type: "sms"; id: string; dir: "inbound" | "outbound" | "ai"; text: string; date: string; sid?: string; status?: string }
  | { type: "call"; id: string; date: string; durationSec?: number; status?: string; recordingUrl?: string; summary?: string; sentiment?: string }
  | { type: "note"; id: string; date: string; text: string }
  | { type: "status"; id: string; date: string; from?: string; to?: string };

// ---- Campaigns (UI-only)
type UICampaign = { _id: string; name: string; key?: string; isActive?: boolean; active?: boolean };

// Canonical Leads destination
const LEADS_URL = "/dashboard?tab=leads";

export default function LeadProfileDial() {
  const router = useRouter();
  const { id } = router.query;

  const [lead, setLead] = useState<Lead | null>(null);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [historyLines, setHistoryLines] = useState<string[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [callsLoading, setCallsLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(false);

  const userHasAI = true;

  // ---- Drip enroll UI state
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<UICampaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [startAtLocal, setStartAtLocal] = useState<string>("");
  const [enrolling, setEnrolling] = useState(false);

  const formatPhone = (phone = "") => {
    const clean = String(phone).replace(/\D/g, "");
    if (clean.length === 10) return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
    if (clean.length === 11 && clean.startsWith("1")) return `${clean.slice(0, 1)}-${clean.slice(1, 4)}-${clean.slice(4, 7)}-${clean.slice(7)}`;
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

      // fallback by phone if looks like a phone
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
      (j.events || []).forEach((ev: HistoryEvent) => {
        if (ev.type === "note") {
          lines.push(`📝 ${ev.text} • ${fmtDateTime(ev.date)}`);
        } else if (ev.type === "sms") {
          const dir = ev.dir === "inbound" ? "⬅️ Inbound SMS" : ev.dir === "outbound" ? "➡️ Outbound SMS" : "🤖 AI SMS";
          const status = (ev as any).status ? ` • ${(ev as any).status}` : "";
          lines.push(`${dir}: ${(ev as any).text}${status} • ${fmtDateTime(ev.date)}`);
        } else if (ev.type === "booking") {
          const title = (ev as any).title || "Booked Appointment";
          const when = (ev as any).startsAt ? fmtDateTime((ev as any).startsAt) : fmtDateTime(ev.date);
          lines.push(`📅 ${title} • ${when}`);
        } else if (ev.type === "status") {
          lines.push(`🔖 Status: ${(ev as any).to || "Updated"} • ${fmtDateTime(ev.date)}`);
        }
      });

      setHistoryLines(lines);
    } catch (e) {
      console.error(e);
    } finally {
      setHistLoading(false);
    }
  }, [resolvedId, id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSaveNote = async () => {
    if (!notes.trim() || !lead?.id) return toast.error("❌ Cannot save an empty note");
    try {
      const r = await fetch("/api/leads/add-history", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, type: "note", message: notes.trim() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message || "Failed to save note");
      }
      setHistoryLines((prev) => [`📝 ${notes.trim()} • ${new Date().toLocaleString()}`, ...prev]);
      setNotes("");
      toast.success("✅ Note saved!");
    } catch (e: any) { toast.error(e?.message || "Failed to save note"); }
  };

  const handleDisposition = async (newFolderName: string) => {
    if (!lead?.id) return;
    if (newFolderName === "No Answer") {
      toast("No change for 'No Answer'");
      return;
    }
    try {
      setHistoryLines((prev) => [`✅ Disposition: ${newFolderName} • ${new Date().toLocaleString()}`, ...prev]);

      const res = await fetch("/api/disposition-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, newFolderName }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || !data?.success) throw new Error(data?.message || "Failed to move lead");

      await fetchLeadById(lead.id);
      loadHistory();
      toast.success(`✅ Lead moved to ${newFolderName}`);
    } catch (error: any) {
      toast.error(error?.message || "Error moving lead");
    }
  };

  const startCall = () => {
    if (!lead?.id) return toast.error("Lead not loaded");
    router.push({ pathname: "/dial-session", query: { leadId: lead.id } });
  };

  const leadName = useMemo(() => {
    const full =
      `${lead?.firstName || lead?.["First Name"] || ""} ${lead?.lastName || lead?.["Last Name"] || ""}`.trim()
      || lead?.name
      || "";
    return full || "Lead";
  }, [lead]);

  const phoneDisplay = useMemo(() => {
    const p = lead?.Phone || lead?.phone || "";
    return formatPhone(p);
  }, [lead]);

  // ---- Enroll modal open + load campaigns
  const [enrollOpenState, setEnrollOpenState] = useState(enrollOpen);
  const openEnrollModal = async () => {
    if (!resolvedId) return toast.error("Lead not loaded");
    setEnrollOpen(true);
    if (campaigns.length === 0) {
      try {
        setCampaignsLoading(true);
        const r = await fetch(`/api/drips/campaigns?active=1`, { cache: "no-store" });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok) throw new Error(j?.error || "Failed to load campaigns");
        const list: UICampaign[] = Array.isArray(j?.campaigns) ? j.campaigns : [];
        setCampaigns(list.filter((c) => (c?.isActive ?? c?.active ?? true)));
      } catch (e: any) {
        toast.error(e?.message || "Failed to load campaigns");
      } finally {
        setCampaignsLoading(false);
      }
    }
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

      const enrolledName = j?.campaign?.name || (campaigns.find((c) => c._id === selectedCampaignId)?.name ?? "campaign");
      setHistoryLines((prev) => [`🔖 Status: Enrolled to ${enrolledName} • ${new Date().toLocaleString()}`, ...prev]);
      loadHistory();

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

  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen">
      <Sidebar />

      {/* LEFT */}
      <div className="w-[320px] p-4 border-r border-gray-700 bg-[#1e293b] overflow-y-auto">
        <div className="mb-2">
          <h2 className="text-xl font-bold">{leadName}</h2>
        </div>

        {Object.entries(lead || {})
          .filter(([key]) => !["_id","id","Notes","First Name","Last Name","folderId","createdAt","ownerId","userEmail"].includes(key))
          .map(([key, value]) => {
            if (key === "Phone" || key.toLowerCase() === "phone") value = formatPhone(String(value || ""));
            return (
              <div key={key}>
                <p className="text-sm"><strong>{key.replace(/_/g, " ")}:</strong> {String(value)}</p>
                <hr className="border-gray-800 my-1" />
              </div>
            );
          })}

        {/* Read-only display of the Saved Notes field */}
        {lead?.Notes && (
          <div className="mt-2">
            <p className="text-sm font-semibold">Saved Notes</p>
            <textarea value={lead.Notes} readOnly className="bg-[#0f172a] border border-white/10 rounded p-2 w-full mt-1 text-sm" rows={3}/>
            <hr className="border-gray-800 my-1" />
          </div>
        )}
        <p className="text-gray-500 mt-2 text-xs">Click fields to edit live.</p>
      </div>

      {/* CENTER */}
      <div className="flex-1 p-6 bg-[#0f172a] border-r border-gray-800 flex flex-col min-h-0">
        <div className="max-w-3xl flex flex-col min-h-0 flex-1">
          <h3 className="text-lg font-bold mb-2">Add a Note</h3>

          <div className="rounded-lg mb-2 bg-[#0f172a] border border-white/10">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full p-3 text-white rounded bg-transparent border-none focus:outline-none" rows={3} placeholder="Type notes here..." />
          </div>

          <div className="flex items-center gap-2 mb-4">
            <button onClick={handleSaveNote} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">Save Note</button>
            <button type="button" onClick={startCall} className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded">Call</button>

            <button
              type="button"
              onClick={openEnrollModal}
              disabled={!lead?.id}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded"
            >
              Enroll in Drip
            </button>
          </div>

          {/* 🔒 PINNED SAVED NOTES — always on top of history */}
          {lead?.Notes ? (
            <>
              <h3 className="text-lg font-bold mb-2">Saved Notes (Pinned)</h3>
              <div className="bg-[#0b1220] border border-white/10 rounded p-3 mb-4">
                <pre className="whitespace-pre-wrap text-sm text-gray-200">{lead.Notes}</pre>
              </div>
            </>
          ) : null}

          {userHasAI && calls.find((c) => c.aiSummary) ? (
            <>
              <h3 className="text-lg font-bold mb-2">AI Call Summary</h3>
              <div className="bg-gray-800/60 border border-white/10 p-3 rounded mb-4">
                <div className="text-sm text-gray-300">{calls.find((c) => c.aiSummary)?.aiSummary}</div>
              </div>
            </>
          ) : null}

          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold mb-2">Interaction History</h3>
            {histLoading ? <span className="text-xs text-gray-400">Loading…</span> : null}
          </div>

          <div className="bg-[#0b1220] border border-white/10 rounded p-3 flex-1 min-h-0 overflow-y-auto">
            {historyLines.length === 0 ? (
              <p className="text-gray-400">No interactions yet.</p>
            ) : (
              historyLines.map((item, idx) => (
                <div key={idx} className="border-b border-white/10 py-2 text-sm">{item}</div>
              ))
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={() => handleDisposition("Sold")} className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded">Sold</button>
            <button onClick={() => handleDisposition("Booked Appointment")} className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded">Booked Appointment</button>
            <button onClick={() => handleDisposition("Not Interested")} className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded">Not Interested</button>
            <button onClick={() => handleDisposition("Resolved")} className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded">Resolve</button>
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
        {/* Enroll card (original placement) */}
        <div className="mb-3 border border-white/10 rounded p-3 bg-[#0f172a]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">Enroll in Drip</span>
            <button
              onClick={openEnrollModal}
              disabled={!lead?.id}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-3 py-1 rounded text-sm"
            >
              Enroll
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Enroll this lead into a specific campaign.</p>
        </div>

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
              <button onClick={() => setEnrollOpen(false)} className="text-gray-300 hover:text-white">✕</button>
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
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank to start immediately; scheduler will handle timing.
                </p>
              </div>

              <div className="border border-white/10 rounded p-2 bg-[#0b1220]">
                <p className="text-xs text-gray-400">
                  Preview of touches will appear here once enabled for this campaign.
                </p>
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
    </div>
  );
}
