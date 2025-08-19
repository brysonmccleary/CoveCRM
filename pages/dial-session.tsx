import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import { isCallAllowed } from "@/utils/checkCallTime";
import {
  playRingback,
  stopRingback,
  primeAudioContext,
} from "@/utils/ringAudio";
import CallSummary from "@/components/CallSummary";
import BookAppointmentModal from "@/components/BookAppointmentModal";
import toast from "react-hot-toast";

interface Lead {
  id: string;
  [key: string]: any;
}

export default function DialSession() {
  const [leadQueue, setLeadQueue] = useState<Lead[]>([]);
  const [currentLeadIndex, setCurrentLeadIndex] = useState(0);
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [fromNumber, setFromNumber] = useState<string>("");
  const [isPaused, setIsPaused] = useState(false);
  const [status, setStatus] = useState("Initializing...");
  const [readyToCall, setReadyToCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sessionStartedCount, setSessionStartedCount] = useState(0);
  const [callActive, setCallActive] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
  const [showBookModal, setShowBookModal] = useState(false);

  const router = useRouter();
  const {
    leads: leadIdsParam,
    fromNumber: fromNumberParam,
    leadId: singleLeadIdParam,
  } = router.query;

  // Prime audio context once for autoplay restrictions (iOS/Safari)
  useEffect(() => {
    try {
      // primeAudioContext previously returned void; calling inside try/catch avoids `.catch()` on void.
      const maybe = primeAudioContext() as unknown;
      // If it *does* return a promise in some environments, make best-effort to silence errors.
      if (maybe && typeof (maybe as any).catch === "function") {
        (maybe as Promise<void>).catch(() => {});
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (fromNumberParam) {
      setFromNumber(fromNumberParam as string);
      localStorage.setItem("selectedDialNumber", fromNumberParam as string);
    } else {
      const saved = localStorage.getItem("selectedDialNumber");
      if (saved) setFromNumber(saved);
    }
  }, [fromNumberParam]);

  useEffect(() => {
    const fetchLeads = async () => {
      if (singleLeadIdParam) {
        const res = await fetch(`/api/get-lead?id=${singleLeadIdParam}`);
        const data = await res.json();
        if (data?.lead) {
          const formatted = { id: data.lead._id, ...data.lead };
          setLeadQueue([formatted]);
          setLead(formatted);
          setCurrentLeadIndex(0);
        }
        return;
      }

      if (!leadIdsParam) return;
      const ids = (leadIdsParam as string).split(",");
      const fetched: (Lead | null)[] = await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`/api/get-lead?id=${id}`);
          if (!res.ok) return null;
          const data = await res.json();
          return { id: data.lead._id, ...data.lead };
        }),
      );
      const validLeads = fetched.filter((lead): lead is Lead => lead !== null);
      setLeadQueue(validLeads);
      if (validLeads.length > 0) {
        setLead(validLeads[0]);
        setCurrentLeadIndex(0);
      }
    };
    fetchLeads();
  }, [leadIdsParam, singleLeadIdParam]);

  useEffect(() => {
    if (leadQueue.length > 0 && readyToCall && !isPaused && sessionStarted) {
      setReadyToCall(false);
      callLead(leadQueue[currentLeadIndex]);
    }
  }, [leadQueue, readyToCall, isPaused, sessionStarted]); // eslint-disable-line react-hooks/exhaustive-deps

  const getPhoneFallback = (lead: Lead) => {
    return (
      lead?.Phone ||
      lead?.phone ||
      lead?.["Phone Number"] ||
      lead?.["phone number"] ||
      Object.entries(lead).find(([key]) =>
        key.toLowerCase().includes("phone"),
      )?.[1] ||
      ""
    );
  };

  const callLead = async (leadToCall: Lead) => {
    const phone = getPhoneFallback(leadToCall);
    if (!phone) return;

    // Optional windowing (quiet hours) guard, non-blocking if util returns true/false
    if (typeof isCallAllowed === "function" && !isCallAllowed()) {
      toast.error("Calls are restricted at this time.");
      return;
    }

    try {
      setStatus("Dialing...");
      setCallActive(true);
      playRingback();

      await fetch("/api/start-conference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadNumber: phone, agentNumber: fromNumber }),
      });

      setTimeout(() => stopRingback(), 8000);
      setSessionStartedCount((prev) => prev + 1);

      // (kept) add basic transcript entry
      await fetch("/api/leads/add-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: leadToCall.id,
          entry: {
            agent: fromNumber,
            text: `Started call at ${new Date().toLocaleTimeString()}`,
          },
        }),
      });

      // ✅ also log to history for the feed
      await fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: leadToCall.id,
          type: "call",
          message: `Call started from ${fromNumber}`,
          meta: { phase: "started" },
        }),
      }).catch(() => {});

      // Local echo
      setHistory((prev) => [
        `📞 Call started (${new Date().toLocaleTimeString()})`,
        ...prev,
      ]);
    } catch (err) {
      console.error("Call failed:", err);
      setStatus("Call failed");
      stopRingback();
      setTimeout(nextLead, 1000);
    }
  };

  const handleSaveNote = async () => {
    if (!notes.trim() || !lead?.id) {
      toast.error("Cannot save an empty note");
      return;
    }
    try {
      // ✅ Persist to canonical notes endpoint (also shows in /api/leads/history as a note)
      const r = await fetch("/api/leads/add-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, text: notes.trim() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message || "Failed to save note");
      }
      // Local echo
      setHistory((prev) => [`📝 Note: ${notes.trim()}`, ...prev]);
      setNotes("");
      toast.success("✅ Note saved!");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to save note");
    }
  };

  const handleToggleSummary = () => setSummaryCollapsed(!summaryCollapsed);
  const toggleMute = () => setMuted(!muted);

  const nextLead = () => {
    if (leadQueue.length <= 1) {
      return showSessionSummary();
    }

    const nextIndex = currentLeadIndex + 1;
    if (nextIndex >= leadQueue.length) return showSessionSummary();

    setCurrentLeadIndex(nextIndex);
    setLead(leadQueue[nextIndex]);
    setReadyToCall(true);
  };

  const disconnectAndNext = () => {
    stopRingback();
    setCallActive(false);
    setReadyToCall(true);
    setTimeout(nextLead, 500);
  };

  const handleHangUp = () => {
    stopRingback();
    // Optional: log hangup as a call history entry
    if (lead?.id) {
      fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          type: "call",
          message: "Call ended by agent",
          meta: { phase: "ended" },
        }),
      }).catch(() => {});
      setHistory((prev) => [`📞 Call ended`, ...prev]);
    }
    disconnectAndNext();
  };

  const togglePause = () => {
    setIsPaused((prev) => !prev);
    if (!isPaused) {
      stopRingback();
      setStatus("Paused");
    } else {
      setReadyToCall(true);
    }
  };

  const handleDisposition = async (status: string) => {
    let newFolderName = "";
    if (status === "Not Interested") newFolderName = "Not Interested";
    else if (status === "Booked Appointment")
      newFolderName = "Booked Appointment";
    else if (status === "Sold") newFolderName = "Sold";
    else if (status === "No Answer") newFolderName = "No Answer";

    try {
      if (leadQueue[currentLeadIndex]?.id) {
        // ✅ Always log disposition to history first
        await fetch("/api/leads/add-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: leadQueue[currentLeadIndex].id,
            type: "disposition",
            message: newFolderName || status,
          }),
        }).catch(() => {});
        setHistory((prev) => [
          `✅ Disposition: ${newFolderName || status}`,
          ...prev,
        ]);
      }

      if (newFolderName && newFolderName !== "No Answer") {
        // Preserve your existing move behavior (no changes)
        const res = await fetch("/api/move-lead-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: leadQueue[currentLeadIndex].id,
            newFolderName,
          }),
        });
        const data = await res.json();
        if (data.success) {
          const updatedQueue = [...leadQueue];
          updatedQueue.splice(currentLeadIndex, 1);

          if (updatedQueue.length === 0) return showSessionSummary();

          const nextIndex =
            currentLeadIndex >= updatedQueue.length
              ? updatedQueue.length - 1
              : currentLeadIndex;
          setLeadQueue(updatedQueue);
          setCurrentLeadIndex(nextIndex);
          setLead(updatedQueue[nextIndex]);
          setReadyToCall(true);
        } else {
          alert("Error moving lead. Please try again.");
        }
      }
    } catch (error) {
      console.error(error);
      // Continue flow
    }

    disconnectAndNext();
  };

  const handleEndSession = () => {
    const confirmEnd = window.confirm(
      `Are you sure you want to end this dial session? You have called ${sessionStartedCount} of ${leadQueue.length} leads.`,
    );
    if (!confirmEnd) return;
    stopRingback();
    setIsPaused(false);
    showSessionSummary();
  };

  const showSessionSummary = () => {
    alert(
      `✅ Session Complete!\nYou called ${sessionStartedCount} out of ${leadQueue.length} leads.`,
    );
    router.push("/leads");
  };

  const formatPhone = (phone: string) => {
    const clean = phone.replace(/\D/g, "");
    if (clean.length === 10)
      return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
    if (clean.length === 11 && clean.startsWith("1"))
      return `${clean.slice(0, 1)}-${clean.slice(1, 4)}-${clean.slice(4, 7)}-${clean.slice(7)}`;
    return phone;
  };

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
          <h2 className="text-xl font-bold mb-2">
            {`${lead?.["First Name"] || ""} ${lead?.["Last Name"] || ""}`.trim()}
          </h2>
          <p className="text-sm text-green-400 mb-2">
            Calling from:{" "}
            {fromNumber ? formatPhone(fromNumber) : "Not selected"}
          </p>
          <p className="text-sm text-yellow-400 mb-2">Status: {status}</p>
          <p className="text-sm text-gray-400 mb-2">
            Lead {currentLeadIndex + 1} of {leadQueue.length}
          </p>

          {lead &&
            Object.entries(lead).map(([key, value]) => {
              if (
                [
                  "_id",
                  "id",
                  "Notes",
                  "First Name",
                  "Last Name",
                  "folderId",
                  "createdAt",
                  "ownerId",
                  "userEmail",
                ].includes(key)
              )
                return null;
              if (key.toLowerCase().includes("phone"))
                value = formatPhone(value as string);
              return (
                <div key={key}>
                  <p>
                    <strong>{key.replace(/_/g, " ")}:</strong>{" "}
                    {String(value) || "-"}
                  </p>
                  <hr className="border-gray-700 my-1" />
                </div>
              );
            })}

          <div className="flex flex-col space-y-2 mt-4">
            <button
              onClick={() => setMuted((m) => !m)}
              className="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded cursor-pointer"
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={handleHangUp}
              className={`px-3 py-2 rounded cursor-pointer ${
                callActive
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-gray-600 hover:bg-gray-700"
              }`}
            >
              Hang Up
            </button>
            <button
              onClick={() => setShowBookModal(true)}
              className="bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded cursor-pointer"
            >
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
            <button
              onClick={handleSaveNote}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded mb-4 cursor-pointer"
            >
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
            <div className="flex justify-center flex-wrap space-x-2">
              <button
                onClick={() => handleDisposition("Sold")}
                className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded cursor-pointer"
              >
                Sold
              </button>
              <button
                onClick={() => handleDisposition("No Answer")}
                className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded cursor-pointer"
              >
                No Answer
              </button>
              <button
                onClick={() => handleDisposition("Booked Appointment")}
                className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded cursor-pointer"
              >
                Booked Appointment
              </button>
              <button
                onClick={() => handleDisposition("Not Interested")}
                className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded cursor-pointer"
              >
                Not Interested
              </button>
            </div>

            <div className="flex space-x-2 mt-2">
              <button
                onClick={() => setIsPaused((p) => !p)}
                className="bg-yellow-400 hover:bg-yellow-500 text-black px-4 py-2 rounded cursor-pointer"
              >
                {isPaused ? "Resume Dial Session" : "Pause Dial Session"}
              </button>
              <button
                onClick={handleEndSession}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded cursor-pointer"
              >
                End Dial Session
              </button>
            </div>
          </div>
        </div>
      </div>

      {lead && (
        <BookAppointmentModal
          isOpen={showBookModal}
          onClose={() => setShowBookModal(false)}
          lead={lead}
        />
      )}
    </div>
  );
}
