// /pages/lead/[id].tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import toast from "react-hot-toast";
import dynamic from "next/dynamic";

// Optional Close-style right rail
const CallPanelClose = dynamic(() => import("@/components/CallPanelClose").catch(() => null), {
  ssr: false,
  loading: () => null,
});

type Lead = {
  id: string;
  _id?: string;
  userEmail?: string;
  name?: string;
  ["First Name"]?: string;
  ["Last Name"]?: string;
  Phone?: string;
  phone?: string;
  Email?: string;
  Notes?: string;
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
  | { type: "booking"; id: string; date: string; title?: string; startsAt?: string; endsAt?: string; calendarId?: string }
  | { type: "note"; id: string; date: string; text: string }
  | { type: "status"; id: string; date: string; from?: string; to?: string };

export default function LeadProfileDial() {
  const router = useRouter();
  const { id } = router.query;

  const [lead, setLead] = useState<Lead | null>(null);
  const [resolvedId, setResolvedId] = useState<string | null>(null); // real Mongo _id once known
  const [notes, setNotes] = useState("");
  const [historyLines, setHistoryLines] = useState<string[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [callsLoading, setCallsLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(false);

  const userHasAI = true;

  const formatPhone = (phone = "") => {
    const clean = String(phone).replace(/\D/g, "");
    if (clean.length === 10) return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
    if (clean.length === 11 && clean.startsWith("1"))
      return `${clean.slice(0, 1)}-${clean.slice(1, 4)}-${clean.slice(4, 7)}-${clean.slice(7)}`;
    return phone;
  };
  const fmtSecs = (n?: number) => {
    if (!n && n !== 0) return "—";
    const s = Math.max(0, Math.floor(n));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
  };
  const fmtDateTime = (d?: string | Date) => {
    if (!d) return "—";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleString();
  };

  // ------- Load lead details with phone fallback -------
  useEffect(() => {
    const fetchLead = async () => {
      if (!id) return;

      const idStr = Array.isArray(id) ? id[0] : String(id);

      // 1) Try as provided (ObjectId path)
      let r = await fetch(`/api/get-lead?id=${encodeURIComponent(idStr)}`, { cache: "no-store" });
      let j = await r.json().catch(() => ({} as any));
      if (r.ok && j?.lead) {
        setLead({ id: j.lead._id, ...j.lead });
        setResolvedId(j.lead._id);
        return;
      }

      // 2) If that failed and value looks like a phone, try phone path
      const digits = idStr.replace(/\D+/g, "");
      if (!r.ok && digits.length >= 10) {
        r = await fetch(`/api/get-lead?phone=${encodeURIComponent(idStr)}`, { cache: "no-store" });
        j = await r.json().catch(() => ({} as any));
        if (r.ok && j?.lead) {
          setLead({ id: j.lead._id, ...j.lead });
          setResolvedId(j.lead._id);
          return;
        }
      }

      console.error("Error fetching lead:", j?.message || r.statusText);
      toast.error("Lead not found.");
    };

    fetchLead();
  }, [id]);

  // ------- Load merged history using resolved id -------
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
      const events: HistoryEvent[] = j.events || [];

      const lines: string[] = [];
      const callRows: CallRow[] = [];

      events.forEach((ev) => {
        if (ev.type === "note") {
          lines.push(`📝 ${ev.text} • ${fmtDateTime(ev.date)}`);
        } else if (ev.type === "sms") {
          const dir = ev.dir === "inbound" ? "⬅️ Inbound SMS" : ev.dir === "outbound" ? "➡️ Outbound SMS" : "🤖 AI SMS";
          const status = ev.status ? ` • ${ev.status}` : "";
          lines.push(`${dir}: ${ev.text}${status} • ${fmtDateTime(ev.date)}`);
        } else if (ev.type === "call") {
          const base = `📞 Called • ${fmtDateTime(ev.date)} • ${fmtSecs(ev.durationSec)}`;
          if (ev.recordingUrl) {
            lines.push(`${base} • Recording available`);
            callRows.push({
              id: ev.id,
              callSid: ev.id,
              userEmail: "",
              leadId: resolvedId || String(id),
              startedAt: ev.date,
              duration: ev.durationSec,
              recordingUrl: ev.recordingUrl,
              hasRecording: true,
              aiSummary: (ev as any).summary,
              aiSentiment: ((ev as any).sentiment as any) || undefined,
            });
          } else {
            lines.push(ev.durationSec && ev.durationSec > 0 ? base : `📞 Called • ${fmtDateTime(ev.date)} • No answer`);
          }
        } else if (ev.type === "booking") {
          const title = (ev as any).title || "Booked Appointment";
          const when = (ev as any).startsAt ? fmtDateTime((ev as any).startsAt) : fmtDateTime(ev.date);
          lines.push(`📅 ${title} • ${when}`);
        } else if (ev.type === "status") {
          lines.push(`🔖 Status: ${(ev as any).to || "Updated"} • ${fmtDateTime(ev.date)}`);
        }
      });

      setHistoryLines(lines);
      if (callRows.length) {
        setCalls((prev) => (prev.length ? prev : callRows));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setHistLoading(false);
    }
  }, [resolvedId, id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ------- Load right-rail calls using resolved id -------
  const loadCalls = useCallback(async () => {
    const key = resolvedId || (id ? String(id) : "");
    if (!key) return;

    try {
      setCallsLoading(true);
      const r = await fetch(
        `/api/calls/by-lead?leadId=${encodeURIComponent(key)}&page=1&pageSize=25`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Failed to load calls.");
      setCalls(j.rows || []);
    } catch (e) {
      console.error(e);
    } finally {
      setCallsLoading(false);
    }
  }, [resolvedId, id]);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  // Actions
  const handleSaveNote = async () => {
    if (!notes.trim() || !lead?.id) {
      toast.error("❌ Cannot save an empty note");
      return;
    }
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
      console.error(e);
      toast.error(e?.message || "Failed to save note");
    }
  };

  const handleDisposition = async (newFolderName: string) => {
    if (!lead?.id) return;
    try {
      await fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, type: "disposition", message: newFolderName }),
      }).catch(() => {});
      setHistoryLines((prev) => [`✅ Disposition: ${newFolderName} • ${new Date().toLocaleString()}`, ...prev]);

      const res = await fetch("/api/move-lead-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, newFolderName }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Move folder error:", data.message);
        toast.error("Failed to move lead");
        return;
      }
      toast.success(`✅ Lead moved to ${newFolderName}`);
    } catch (error) {
      console.error("Error moving lead:", error);
      toast.error("Error moving lead");
    }
  };

  const startCall = async () => {
    if (!lead?.id) return;
    try {
      const res = await fetch("/api/twilio/voice/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "Failed to start call");
      toast.success("📞 Calling lead…");
    } catch (e: any) {
      toast.error(e?.message || "Failed to start call");
    }
  };

  const leadName = useMemo(() => {
    const full = `${lead?.["First Name"] || ""} ${lead?.["Last Name"] || ""}`.trim() || lead?.name || "";
    return full || "Lead";
  }, [lead]);

  const phoneDisplay = useMemo(() => {
    const p = lead?.Phone || lead?.phone || "";
    return formatPhone(p);
  }, [lead]);

  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen">
      <Sidebar />

      {/* LEFT: Lead facts */}
      <div className="w-[320px] p-4 border-r border-gray-700 bg-[#1e293b] overflow-y-auto">
        <div className="mb-2">
          <h2 className="text-xl font-bold">{leadName}</h2>
          {phoneDisplay ? <div className="text-gray-300">{phoneDisplay}</div> : null}
        </div>

        {Object.entries(lead || {})
          .filter(([key]) => !["_id", "id", "Notes", "First Name", "Last Name", "folderId", "createdAt", "ownerId"].includes(key))
          .map(([key, value]) => {
            if (key === "Phone" || key.toLowerCase() === "phone") value = formatPhone(String(value || ""));
            return (
              <div key={key}>
                <p className="text-sm">
                  <strong>{key.replace(/_/g, " ")}:</strong> {String(value)}
                </p>
                <hr className="border-gray-800 my-1" />
              </div>
            );
          })}

        {lead?.Notes && (
          <div className="mt-2">
            <p className="text-sm font-semibold">Notes</p>
            <textarea
              value={lead.Notes}
              onChange={() => {}}
              readOnly
              className="bg-[#0f172a] border border-white/10 rounded p-2 w-full mt-1 text-sm"
              rows={3}
            />
            <hr className="border-gray-800 my-1" />
          </div>
        )}

        <p className="text-gray-500 mt-2 text-xs">Click fields to edit live.</p>
      </div>

      {/* CENTER: Notes + History */}
      <div className="flex-1 p-6 bg-[#0f172a] border-r border-gray-800">
        <div className="max-w-3xl">
          <h3 className="text-lg font-bold mb-2">Notes</h3>

          {/* ⬇️ This was the white box; now dark blue to match CRM */}
          <div className="rounded-lg mb-2 bg-[#0f172a] border border-white/10">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-3 text-white rounded bg-transparent border-none focus:outline-none"
              rows={3}
              placeholder="Type notes here..."
            />
          </div>

          <div className="flex items-center gap-2 mb-6">
            <button onClick={handleSaveNote} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
              Save Note
            </button>
            <button onClick={startCall} className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded">
              Call
            </button>
          </div>

          {userHasAI && calls.find((c) => c.aiSummary) ? (
            <>
              <h3 className="text-lg font-bold mb-2">AI Call Summary</h3>
              <div className="bg-gray-800/60 border border-white/10 p-3 rounded mb-6">
                <div className="text-sm text-gray-300">{calls.find((c) => c.aiSummary)?.aiSummary}</div>
              </div>
            </>
          ) : null}

          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold mb-2">Interaction History</h3>
            {histLoading ? <span className="text-xs text-gray-400">Loading…</span> : null}
          </div>
          <div className="bg-[#0b1220] border border-white/10 rounded p-3 max-h-[420px] overflow-y-auto">
            {historyLines.length === 0 ? (
              <p className="text-gray-400">No interactions yet.</p>
            ) : (
              historyLines.map((item, idx) => (
                <div key={idx} className="border-b border-white/10 py-2 text-sm">
                  {item}
                </div>
              ))
            )}

            {callsLoading ? (
              <div className="text-gray-400 text-sm mt-2">Loading calls…</div>
            ) : (
              calls.slice(0, 3).map((c) =>
                c.recordingUrl ? (
                  <div key={`rec-${c.id}`} className="mt-3">
                    <div className="text-xs text-gray-400 mb-1">
                      Recording • {fmtDateTime(c.startedAt)} • {fmtSecs(c.duration)}
                    </div>
                    <audio controls preload="none" src={c.recordingUrl} className="w-full" />
                  </div>
                ) : null
              )
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-6">
            <button onClick={() => handleDisposition("Sold")} className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded">
              Sold
            </button>
            <button onClick={() => handleDisposition("Booked Appointment")} className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded">
              Booked Appointment
            </button>
            <button onClick={() => handleDisposition("Not Interested")} className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded">
              Not Interested
            </button>
          </div>

          <div className="mt-6">
            <button className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded">End Dial Session</button>
          </div>
        </div>
      </div>

      {/* RIGHT: Calls panel */}
      <div className="w-[400px] p-4 bg-[#0b1220]">
        {lead?.id ? (
          CallPanelClose ? (
            <CallPanelClose
              leadId={lead.id}
              userHasAI={userHasAI}
              defaultFromNumber={process.env.NEXT_PUBLIC_DEFAULT_FROM as string | undefined}
              onOpenCall={(callId) => router.push(`/calls/${callId}`)}
            />
          ) : (
            <div className="bg-[#0b1220] border border-white/10 rounded-xl">
              <div className="px-4 py-3 border-b border-white/10">
                <div className="text-xs text-gray-400">Activity</div>
                <div className="text-base font-semibold text-white">Calls</div>
              </div>
              <ul className="divide-y divide-white/10">
                {calls.map((c) => (
                  <li key={c.id} className="px-3 py-2">
                    <div className="text-sm">
                      {fmtDateTime(c.startedAt)} • {fmtSecs(c.duration)} •{" "}
                      {c.hasRecording ? "Recording" : (c.duration ?? 0) > 0 ? "Completed" : "No answer"}
                    </div>
                    {c.recordingUrl ? <audio controls preload="none" src={c.recordingUrl} className="w-full mt-2" /> : null}
                    {userHasAI && c.aiSummary ? (
                      <div className="mt-2 text-xs text-gray-300 whitespace-pre-line">{c.aiSummary}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
