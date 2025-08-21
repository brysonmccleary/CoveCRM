// pages/dial-session.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import CallSummary from "@/components/CallSummary";
import BookAppointmentModal from "@/components/BookAppointmentModal";
import { isCallAllowed } from "@/utils/checkCallTime";
import { playRingback, stopRingback, primeAudioContext } from "@/utils/ringAudio";
import toast from "react-hot-toast";

interface Lead {
  id: string;
  [key: string]: any;
}

type Json = Record<string, any>;

export default function DialSession() {
  const router = useRouter();
  const { leads: leadIdsParam, fromNumber: fromNumberParam, leadId: singleLeadIdParam } = router.query;

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

  // UI bits
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
  const [showBookModal, setShowBookModal] = useState(false);
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  // Numbers (for display only; server resolves authoritative values)
  const [fromNumber, setFromNumber] = useState<string>("");
  const [agentPhone, setAgentPhone] = useState<string>("");

  // ensure we don’t auto-dial before numbers are loaded (race fix)
  const [numbersLoaded, setNumbersLoaded] = useState(false);

  // sockets + watchdogs
  const socketRef = useRef<any>(null);
  const userEmailRef = useRef<string>("");
  const callWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceScheduledRef = useRef<boolean>(false);

  /** ---------- helpers ---------- */

  const formatPhone = (phone: string) => {
    const clean = (phone || "").replace(/\D/g, "");
    if (clean.length === 10) return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
    if (clean.length === 11 && clean.startsWith("1"))
      return `${clean.slice(0, 1)}-${clean.slice(1, 4)}-${clean.slice(4, 7)}-${clean.slice(7)}`;
    return phone || "";
  };

  const normalizeE164 = (raw?: string) => {
    if (!raw) return "";
    const d = raw.replace(/\D+/g, "");
    if (!d) return "";
    if (d.startsWith("1") && d.length === 11) return `+${d}`;
    if (d.length === 10) return `+1${d}`;
    if (raw.startsWith("+")) return raw.trim();
    return `+${d}`;
  };

  const getLeadPhoneForLegacy = () => {
    const l = leadQueue[currentLeadIndex];
    if (!l) return "";
    return (
      (l as any)?.Phone ||
      (l as any)?.phone ||
      (l as any)?.["Phone Number"] ||
      (l as any)?.["phone number"] ||
      Object.entries(l).find(([k]) => k.toLowerCase().includes("phone"))?.[1] ||
      ""
    ) as string;
  };

  const currentLeadE164 = () => normalizeE164(getLeadPhoneForLegacy());

  const fetchJson = async <T = Json>(url: string, init?: RequestInit) => {
    const r = await fetch(url, init);
    if (!r.ok) throw new Error(`${r.status}`);
    return (await r.json()) as T;
  };

  // Try to find agentPhone in several likely shapes from /api/settings/profile
  const extractAgentPhone = (obj: Json): string | null => {
    const candidates = [
      obj?.agentPhone,
      obj?.profile?.agentPhone,
      obj?.settings?.agentPhone,
      obj?.user?.agentPhone,
      obj?.data?.agentPhone,
      obj?.phone,
      obj?.agent_phone,
      obj?.agentMobile,
      obj?.agentNumber,
    ].filter(Boolean);
    if (candidates.length) return String(candidates[0]);

    // last-ditch: scan recursively
    const scan = (o: any): string | null => {
      if (!o || typeof o !== "object") return null;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && k.toLowerCase().includes("agent") && k.toLowerCase().includes("phone")) {
          return v;
        }
        if (typeof v === "object") {
          const found = scan(v);
          if (found) return found;
        }
      }
      return null;
    };
    return scan(obj);
  };

  const pickFirstVoiceNumber = (payload: Json): string | null => {
    const arr: any[] =
      payload?.numbers ||
      payload?.incomingPhoneNumbers ||
      payload?.data ||
      payload?.items ||
      [];
    for (const n of arr) {
      const num = n?.phoneNumber || n?.friendlyName || n?.number || n?.value || n;
      const caps = n?.capabilities || n?.capability || {};
      const hasVoice = typeof caps === "object" ? !!(caps.voice ?? caps.Voice ?? caps.VOICE) : true;
      if (num && hasVoice) return String(num);
    }
    return arr[0]?.phoneNumber || null;
  };

  const clearWatchdog = () => {
    if (callWatchdogRef.current) {
      clearTimeout(callWatchdogRef.current);
      callWatchdogRef.current = null;
    }
  };

  const scheduleWatchdog = () => {
    clearWatchdog();
    // Server times out at 25s; we give a little cushion (≈27s total) then advance.
    callWatchdogRef.current = setTimeout(() => {
      if (advanceScheduledRef.current) return;
      setStatus("No answer (timeout)");
      stopRingback();
      advanceScheduledRef.current = true;
      setTimeout(disconnectAndNext, 1200);
    }, 27000);
  };

  /** ---------- bootstrap ---------- */

  // 1) Prime audio once for autoplay restrictions
  useEffect(() => {
    try {
      const maybe = primeAudioContext() as unknown;
      if (maybe && typeof (maybe as any).catch === "function") (maybe as Promise<void>).catch(() => {});
    } catch {}
  }, []);

  // 2) Load agentPhone from profile, and fromNumber from query/localStorage/Twilio numbers
  useEffect(() => {
    let cancelled = false;
    const loadNumbers = async () => {
      setNumbersLoaded(false);

      // fromNumber: query → localStorage → owned numbers API
      if (typeof fromNumberParam === "string" && fromNumberParam) {
        if (!cancelled) {
          setFromNumber(fromNumberParam);
          localStorage.setItem("selectedDialNumber", fromNumberParam);
        }
      } else {
        const saved = localStorage.getItem("selectedDialNumber");
        if (saved) {
          if (!cancelled) setFromNumber(saved);
        } else {
          try {
            const list = await fetchJson<Json>("/api/twilio/list-numbers").catch(async () => {
              return await fetchJson<Json>("/api/getNumbers");
            });
            if (!cancelled) {
              const first = pickFirstVoiceNumber(list);
              if (first) {
                setFromNumber(first);
                localStorage.setItem("selectedDialNumber", first);
              }
            }
          } catch {
            // leave blank; server will still try to resolve
          }
        }
      }

      // agentPhone from profile
      try {
        const profile = await fetchJson<Json>("/api/settings/profile");
        const extracted = extractAgentPhone(profile);
        if (!cancelled && extracted) setAgentPhone(extracted);
      } catch {
        // ignore (server will resolve if possible)
      }

      if (!cancelled) setNumbersLoaded(true);
    };
    loadNumbers();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromNumberParam]);

  // 3) Load leads, set auto-start flags
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

      // Multiple leads
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

  // 4) Auto-dial when armed (wait until numbersLoaded to avoid race)
  useEffect(() => {
    if (!numbersLoaded) {
      setStatus("Loading your numbers…");
      return;
    }
    if (leadQueue.length > 0 && readyToCall && !isPaused && sessionStarted) {
      setReadyToCall(false);
      callLead(leadQueue[currentLeadIndex]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numbersLoaded, leadQueue, readyToCall, isPaused, sessionStarted, currentLeadIndex]);

  /** ---------- calling ---------- */

  // Prefer server-resolved endpoint; fall back if missing
  const startOutboundCall = async (leadId: string) => {
    const attempts: Array<{ url: string; body: Record<string, any> }> = [
      // 🔹 server resolves fromNumber & agentPhone using the user profile
      { url: "/api/twilio/voice/call", body: { leadId } },
      // legacy fallbacks (explicit numbers if needed)
      { url: "/api/twilio/make-call", body: { leadNumber: getLeadPhoneForLegacy(), agentNumber: agentPhone, from: fromNumber } },
      { url: "/api/start-conference", body: { leadNumber: getLeadPhoneForLegacy(), agentNumber: agentPhone, from: fromNumber } },
    ];

    let lastErr: Error | null = null;
    for (const a of attempts) {
      try {
        const r = await fetch(a.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(a.body),
        });
        if (r.status === 404) continue; // route not present; try next
        if (!r.ok) {
          let msg = `Failed to start call (${a.url})`;
          try {
            const j = await r.json();
            if (j?.message) msg = j.message;
          } catch {}
          throw new Error(msg);
        }
        return; // success
      } catch (e: any) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr || new Error("No available call endpoint");
  };

  const callLead = async (leadToCall: Lead) => {
    if (!leadToCall?.id) {
      setStatus("Missing lead id");
      return;
    }

    // Optional quiet hours guard
    if (typeof isCallAllowed === "function" && !isCallAllowed()) {
      toast.error("Calls are restricted at this time.");
      setStatus("Blocked by schedule");
      return;
    }

    try {
      advanceScheduledRef.current = false;
      setStatus("Dialing…");
      setCallActive(true);
      playRingback();

      // 🔸 Let the server resolve numbers; don’t block on client-side checks
      await startOutboundCall(leadToCall.id);

      // Local watchdog in case a webhook is missed (server has 25s timeout)
      scheduleWatchdog();

      // stop ringback after a bit even if device events don't fire
      setTimeout(() => stopRingback(), 8000);
      setSessionStartedCount((n) => n + 1);

      // transcript + history
      fetch("/api/leads/add-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: leadToCall.id,
          entry: { agent: fromNumber || "auto", text: `Started call at ${new Date().toLocaleTimeString()}` },
        }),
      }).catch(() => {});
      fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: leadToCall.id,
          type: "call",
          message: `Call started`,
          meta: { phase: "started" },
        }),
      }).catch(() => {});
      setHistory((prev) => [`📞 Call started (${new Date().toLocaleTimeString()})`, ...prev]);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message || "Call failed");
      stopRingback();
      clearWatchdog();
      setCallActive(false);
      // move on so sessions never stall
      setTimeout(disconnectAndNext, 1200);
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
    clearWatchdog();
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
    clearWatchdog();
    setCallActive(false);
    setReadyToCall(true);
    setTimeout(nextLead, 500);
  };

  const togglePause = () => {
    setIsPaused((p) => !p);
    if (!isPaused) {
      stopRingback();
      clearWatchdog();
      setStatus("Paused");
    } else {
      setReadyToCall(true);
      setStatus("Ready");
    }
  };

  const handleEndSession = () => {
    const ok = window.confirm(
      `Are you sure you want to end this dial session? You have called ${sessionStartedCount} of ${leadQueue.length} leads.`
    );
    if (!ok) return;
    stopRingback();
    clearWatchdog();
    setIsPaused(false);
    showSessionSummary();
  };

  const showSessionSummary = () => {
    alert(`✅ Session Complete!\nYou called ${sessionStartedCount} out of ${leadQueue.length} leads.`);
    router.push("/leads").catch(() => {});
  };

  /** ---------- socket wiring (live call:status) ---------- */

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // get user email to join their room
        const sess = await fetchJson<{ user?: { email?: string } }>("/api/auth/session").catch(() => null as any);
        const email = sess?.user?.email ? String(sess.user.email).toLowerCase() : "";
        userEmailRef.current = email;

        // dynamic import so we don't hard-require the dep if it's not installed
        const mod = await import("socket.io-client").catch(() => null as any);
        if (!mounted || !mod) return;
        const { io } = mod as any;

        const socket = io(undefined, {
          transports: ["websocket"],
          withCredentials: false,
        });

        socketRef.current = socket;

        socket.on("connect", () => {
          // Try common join events; harmless if server ignores
          if (email) {
            socket.emit("join", email);
            socket.emit("room:join", email);
            socket.emit("user:join", email);
          }
        });

        socket.on("disconnect", () => {});

        // Main event from status-callback.ts
        socket.on("call:status", (payload: any) => {
          try {
            // payload: { callSid, status, direction, ownerNumber, otherNumber, durationSec, terminal, timestamp }
            const leadNum = currentLeadE164();
            const eventOther = normalizeE164(payload?.otherNumber || "");
            const ownerNum = normalizeE164(payload?.ownerNumber || "");
            const fromNum = normalizeE164(fromNumber || "");

            // Only react to our current call leg (outbound to this lead, from our chosen Twilio DID)
            if (leadNum && eventOther && leadNum !== eventOther) return;
            if (fromNum && ownerNum && fromNum !== ownerNum) return;

            const s = String(payload?.status || "").toLowerCase();

            if (s === "initiated") setStatus("Dial initiated…");
            if (s === "ringing") setStatus("Ringing…");
            if (s === "answered") {
              setStatus("Connected");
              stopRingback();
              clearWatchdog();
            }

            if (s === "no-answer" || s === "busy" || s === "failed") {
              stopRingback();
              clearWatchdog();
              if (!advanceScheduledRef.current) {
                advanceScheduledRef.current = true;
                setStatus(s === "no-answer" ? "No answer" : s === "busy" ? "Busy" : "Failed");
                setTimeout(disconnectAndNext, 1200); // 1.2s delay for natural pacing
              }
            }

            if (s === "completed") {
              stopRingback();
              clearWatchdog();
              if (!advanceScheduledRef.current) {
                advanceScheduledRef.current = true;
                setTimeout(disconnectAndNext, 1200);
              }
            }
          } catch {}
        });
      } catch {}
    })();

    return () => {
      mounted = false;
      try {
        socketRef.current?.off?.("call:status");
        socketRef.current?.disconnect?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeadIndex, leadQueue.length, fromNumber]);

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
            Calling from: {fromNumber ? formatPhone(fromNumber) : "Resolving…"}
          </p>
          <p className="text-yellow-400">
            Agent phone: {agentPhone ? formatPhone(agentPhone) : "Resolving…"}
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
