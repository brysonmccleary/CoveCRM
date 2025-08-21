// /pages/dial-session.tsx
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import CallSummary from "@/components/CallSummary";
import BookAppointmentModal from "@/components/BookAppointmentModal";
import { playRingback, stopRingback, primeAudioContext } from "@/utils/ringAudio";
import toast from "react-hot-toast";

interface Lead {
  id: string;
  [key: string]: any;
}
type Json = Record<string, any>;

export default function DialSession() {
  const router = useRouter();
  const { leads: leadIdsParam, leadId: singleLeadIdParam } = router.query;

  // Queue & selection
  const [leadQueue, setLeadQueue] = useState<Lead[]>([]);
  const [currentLeadIndex, setCurrentLeadIndex] = useState(0);
  const lead = useMemo(() => leadQueue[currentLeadIndex] ?? null, [leadQueue, currentLeadIndex]);

  // Calling state
  const [status, setStatus] = useState("Initializing…");
  const [readyToCall, setReadyToCall] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionStartedCount, setSessionStartedCount] = useState(0);

  // UI
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
  const [showBookModal, setShowBookModal] = useState(false);
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  // Optional display-only numbers (not required for calling)
  const [displayFrom, setDisplayFrom] = useState<string>("");
  const [displayAgent, setDisplayAgent] = useState<string>("");

  /** ---------- helpers ---------- */

  const formatPhone = (phone: string) => {
    const clean = (phone || "").replace(/\D/g, "");
    if (clean.length === 10) return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
    if (clean.length === 11 && clean.startsWith("1"))
      return `${clean.slice(0, 1)}-${clean.slice(1, 4)}-${clean.slice(4, 7)}-${clean.slice(7)}`;
    return phone || "";
  };

  const getPhoneFallback = (l: Lead) =>
    l?.Phone ||
    l?.phone ||
    l?.["Phone Number"] ||
    l?.["phone number"] ||
    Object.entries(l).find(([k]) => k.toLowerCase().includes("phone"))?.[1] ||
    "";

  const fetchJson = async <T = Json>(url: string, init?: RequestInit) => {
    const r = await fetch(url, init);
    if (!r.ok) throw new Error(`${r.status}`);
    return (await r.json()) as T;
  };

  /** ---------- bootstrap ---------- */

  // 1) Prime audio once for autoplay restrictions
  useEffect(() => {
    try {
      const maybe = primeAudioContext() as unknown;
      if (maybe && typeof (maybe as any).catch === "function") (maybe as Promise<void>).catch(() => {});
    } catch {}
  }, []);

  // 2) Load optional display numbers from profile (not required for calls anymore)
  useEffect(() => {
    (async () => {
      try {
        const profile = await fetchJson<Json>("/api/settings/profile").catch(() => null);
        const from =
          profile?.settings?.defaultFromNumber ||
          profile?.defaultFromNumber ||
          (Array.isArray(profile?.numbers) ? profile?.numbers?.[0]?.phoneNumber : undefined);
        const agent =
          profile?.settings?.agentPhone ||
          profile?.agentPhone ||
          profile?.phone ||
          profile?.profile?.phone ||
          profile?.personalPhone;
        if (from) setDisplayFrom(String(from));
        if (agent) setDisplayAgent(String(agent));
      } catch {}
    })();
  }, []);

  // 3) Load leads & arm auto-start
  useEffect(() => {
    const loadLeads = async () => {
      // Single lead
      if (singleLeadIdParam) {
        try {
          const j = await fetchJson<Json>(`/api/get-lead?id=${singleLeadIdParam}`);
          if (j?.lead?._id) {
            const formatted = { id: j.lead._id, ...j.lead };
            setLeadQueue([formatted]);
            setCurrentLeadIndex(0);
            setSessionStarted(true);
            setReadyToCall(true);
            setStatus("Ready");
          } else {
            toast.error("Lead not found");
            setStatus("Idle");
          }
        } catch {
          toast.error("Failed to load lead");
          setStatus("Idle");
        }
        return;
      }

      // Multi-lead
      if (!leadIdsParam) return;
      const ids = String(leadIdsParam).split(",").filter(Boolean);
      try {
        const fetched = await Promise.all(
          ids.map(async (id) => {
            try {
              const j = await fetchJson<Json>(`/api/get-lead?id=${encodeURIComponent(id)}`);
              return j?.lead?._id ? ({ id: j.lead._id, ...j.lead } as Lead) : null;
            } catch {
              return null;
            }
          })
        );
        const valid = fetched.filter(Boolean) as Lead[];
        setLeadQueue(valid);
        setCurrentLeadIndex(0);
        if (valid.length) {
          setSessionStarted(true);
          setReadyToCall(true);
          setStatus("Ready");
        } else {
          setStatus("Idle");
          toast("No valid leads to dial");
        }
      } catch {
        setStatus("Idle");
        toast.error("Failed to load leads");
      }
    };
    loadLeads();
  }, [leadIdsParam, singleLeadIdParam]);

  // 4) Auto-dial when armed
  useEffect(() => {
    if (leadQueue.length > 0 && readyToCall && !isPaused && sessionStarted) {
      setReadyToCall(false);
      callLead(leadQueue[currentLeadIndex]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadQueue, readyToCall, isPaused, sessionStarted, currentLeadIndex]);

  /** ---------- calling ---------- */

  const callLead = async (leadToCall: Lead) => {
    const to = String(getPhoneFallback(leadToCall) || "").trim();
    if (!to) {
      toast.error("Lead has no phone");
      setStatus("Missing lead phone");
      return;
    }

    try {
      setStatus("Dialing…");
      setCallActive(true);
      playRingback();

      const r = await fetch("/api/twilio/voice/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: leadToCall.id }),
      });

      if (!r.ok) {
        let msg = "Failed to start call";
        try {
          const j = await r.json();
          if (j?.message) msg = j.message;
        } catch {}
        throw new Error(msg);
      }

      const j = await r.json().catch(() => ({}));
      // Show friendly “who’s calling who” if available
      if (j?.fromNumber || j?.agentPhone) {
        setDisplayFrom(j.fromNumber || displayFrom);
        setDisplayAgent(j.agentPhone || displayAgent);
      }

      // Stop ringback after a moment even if we don't receive device events here
      setTimeout(() => stopRingback(), 8000);
      setSessionStartedCount((n) => n + 1);

      // Log to lead transcript/history (best-effort)
      fetch("/api/leads/add-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: leadToCall.id,
          entry: { text: `Started call at ${new Date().toLocaleTimeString()}` },
        }),
      }).catch(() => {});
      fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: leadToCall.id,
          type: "call",
          message: "Call started",
          meta: { phase: "started" },
        }),
      }).catch(() => {});
      setHistory((prev) => [`📞 Call started (${new Date().toLocaleTimeString()})`, ...prev]);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message || "Call failed");
      stopRingback();
      setCallActive(false);
      // keep sessions flowing; move on
      setTimeout(nextLead, 1000);
    }
  };

  /** ---------- notes / dispositions ---------- */

  const handleSaveNote = async () => {
    if (!notes.trim() || !lead?.id) return toast.error("Cannot save an empty note");
    try {
      const r = await fetch("/api/leads/add-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, text: notes.trim() }),
      });
      if (!r.ok) {
        let msg = "Failed to save note";
        try {
          const j = await r.json();
          if (j?.message) msg = j.message;
        } catch {}
        throw new Error(msg);
      }
      setHistory((prev) => [`📝 Note: ${notes.trim()}`, ...prev]);
      setNotes("");
      toast.success("✅ Note saved!");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to save note");
    }
  };

  const handleHangUp = () => {
    stopRingback();
    if (lead?.id) {
      fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, type: "call", message: "Call ended by agent", meta: { phase: "ended" } }),
      }).catch(() => {});
      setHistory((prev) => [`📞 Call ended`, ...prev]);
    }
    setStatus("Ended");
    disconnectAndNext();
  };

  const handleDisposition = async (status: string) => {
    let newFolderName = "";
    if (status === "Not Interested") newFolderName = "Not Interested";
    else if (status === "Booked Appointment") newFolderName = "Booked Appointment";
    else if (status === "Sold") newFolderName = "Sold";
    else if (status === "No Answer") newFolderName = "No Answer";

    try {
      if (leadQueue[currentLeadIndex]?.id) {
        fetch("/api/leads/add-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: leadQueue[currentLeadIndex].id, type: "disposition", message: newFolderName || status }),
        }).catch(() => {});
        setHistory((prev) => [`✅ Disposition: ${newFolderName || status}`, ...prev]);
      }

      if (newFolderName && newFolderName !== "No Answer") {
        const r = await fetch("/api/move-lead-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: leadQueue[currentLeadIndex].id, newFolderName }),
        });
        const j = await r.json();
        if (j?.success) {
          const updated = [...leadQueue];
          updated.splice(currentLeadIndex, 1);
          if (!updated.length) return showSessionSummary();
          const nextIndex = currentLeadIndex >= updated.length ? updated.length - 1 : currentLeadIndex;
          setLeadQueue(updated);
          setCurrentLeadIndex(nextIndex);
          setReadyToCall(true);
        } else {
          alert("Error moving lead. Please try again.");
        }
      }
    } catch (e) {
      console.error(e);
    }
    disconnectAndNext();
  };

  /** ---------- flow helpers ---------- */

  const nextLead = () => {
    if (leadQueue.length <= 1) return showSessionSummary();
    const nextIndex = currentLeadIndex + 1;
    if (nextIndex >= leadQueue.length) return showSessionSummary();
    setCurrentLeadIndex(nextIndex);
    setReadyToCall(true);
  };

  const disconnectAndNext = () => {
    stopRingback();
    setCallActive(false);
    setReadyToCall(true);
    setTimeout(nextLead, 500);
  };

  const togglePause = () => {
    setIsPaused((p) => !p);
    if (!isPaused) {
      stopRingback();
      setStatus("Paused");
    } else {
      setReadyToCall(true);
      setStatus("Ready");
    }
  };

  const showSessionSummary = () => {
    alert(`✅ Session Complete!\nYou called ${sessionStartedCount} out of ${leadQueue.length} leads.`);
    router.push("/leads").catch(() => {});
  };

  const handleEndSession = () => {
    const ok = window.confirm(
      `Are you sure you want to end this dial session? You have called ${sessionStartedCount} of ${leadQueue.length} leads.`
    );
    if (!ok) return;
    stopRingback();
    setIsPaused(false);
    showSessionSummary();
  };

  /** ---------- render ---------- */

  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen flex-col">
      <div className="bg-[#1e293b] p-4 border-b border-gray-700 flex justify-between items-center">
        <h1 className="text-xl font-bold">Dial Session</h1>
        <button
          onClick={() => setSummaryCollapsed((s) => !s)}
          className="text-sm px-3 py-1 rounded bg-gray-700 hover:bg-gray-600"
        >
          {summaryCollapsed ? "Show Summary" : "Hide Summary"}
        </button>
      </div>

      {!summaryCollapsed && (
        <div className="bg-[#1e293b] text-white border-b border-gray-700 p-4">
          <CallSummary lead={lead} />
        </div>
      )}

      <div className="flex flex-1">
        <Sidebar />

        <div className="w-1/4 p-4 border-r border-gray-600 bg-[#1e293b] overflow-y-auto">
          <p className="text-green-400">
            Calling from: {displayFrom ? formatPhone(displayFrom) : "Auto (user default)"}
          </p>
          <p className="text-yellow-400">
            Agent phone: {displayAgent ? formatPhone(displayAgent) : "Auto (from profile)"}
          </p>
          <p className="text-yellow-500 mb-2">Status: {status}</p>

          <p className="text-sm text-gray-400 mb-2">
            Lead {Math.min(currentLeadIndex + 1, Math.max(leadQueue.length, 1))} of {leadQueue.length || 1}
          </p>

          {lead &&
            Object.entries(lead).map(([key, value]) => {
              if (
                ["_id", "id", "Notes", "First Name", "Last Name", "folderId", "createdAt", "ownerId", "userEmail"].includes(
                  key
                )
              )
                return null;
              const showVal =
                typeof value === "string" && key.toLowerCase().includes("phone") ? formatPhone(value) : String(value ?? "-");
              return (
                <div key={key}>
                  <p>
                    <strong>{key.replace(/_/g, " ")}:</strong> {showVal}
                  </p>
                  <hr className="border-gray-700 my-1" />
                </div>
              );
            })}

          <div className="flex flex-col space-y-2 mt-4">
            <button onClick={() => setMuted((m) => !m)} className="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded">
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={handleHangUp}
              className={`px-3 py-2 rounded ${
                callActive ? "bg-red-600 hover:bg-red-700" : "bg-gray-600 hover:bg-gray-700"
              }`}
            >
              Hang Up
            </button>
            <button onClick={() => setShowBookModal(true)} className="bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded">
              📅 Book Appointment
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 bg-[#1e293b] flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold mb-2">Notes</h3>
            <div className="border border-gray-500 rounded p-2 mb-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2 text-white rounded bg-transparent border-none focus:outline-none"
                rows={3}
                placeholder="Type notes here..."
              />
            </div>
            <button onClick={handleSaveNote} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded mb-4">
              Save Note
            </button>

            <h3 className="text-lg font-bold mb-2">Interaction History</h3>
            <div className="bg-gray-800 p-3 rounded max-h-60 overflow-y-auto">
              {history.length === 0 ? (
                <p className="text-gray-400">No interactions yet.</p>
              ) : (
                history.map((item, idx) => (
                  <p key={idx} className="border-b border-gray-700 py-1">
                    {item}
                  </p>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col items-center mt-8 space-y-4">
            <div className="flex justify-center flex-wrap gap-2">
              <button onClick={() => handleDisposition("Sold")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">
                Sold
              </button>
              <button onClick={() => handleDisposition("No Answer")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">
                No Answer
              </button>
              <button
                onClick={() => handleDisposition("Booked Appointment")}
                className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded"
              >
                Booked Appointment
              </button>
              <button
                onClick={() => handleDisposition("Not Interested")}
                className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded"
              >
                Not Interested
              </button>
            </div>

            <div className="flex gap-2 mt-2">
              <button onClick={togglePause} className="bg-yellow-400 hover:bg-yellow-500 text-black px-4 py-2 rounded">
                {isPaused ? "Resume Dial Session" : "Pause Dial Session"}
              </button>
              <button onClick={handleEndSession} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded">
                End Dial Session
              </button>
            </div>
          </div>
        </div>
      </div>

      {lead && (
        <BookAppointmentModal isOpen={showBookModal} onClose={() => setShowBookModal(false)} lead={lead} />
      )}
    </div>
  );
}
