// components/messages/ChatThread.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Socket } from "socket.io-client";
import { InboxMode } from "./InboxSidebar";

interface Message {
  _id?: string;
  text: string;
  direction: "inbound" | "outbound" | "ai";
  leadId?: string;

  // old/optional
  date?: string;

  // ✅ what your API actually returns
  sentAt?: string;
  createdAt?: string;
  queuedAt?: string;
}

interface EmailMsg {
  _id: string;
  subject: string;
  to: string;
  from: string;
  direction: "outbound" | "inbound";
  status: "queued" | "sent" | "delivered" | "opened" | "bounced" | "replied" | "failed";
  sentAt?: string;
  createdAt?: string;
}

interface ChatThreadProps {
  leadId: string;
  socket: Socket | null;
  mode?: InboxMode;
}

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-gray-600 text-gray-200",
  sent: "bg-blue-700 text-blue-100",
  delivered: "bg-green-700 text-green-100",
  opened: "bg-teal-700 text-teal-100",
  bounced: "bg-red-700 text-red-100",
  replied: "bg-purple-700 text-purple-100",
  failed: "bg-red-700 text-red-100",
};

function getAgentTimeZone(): string {
  // Matches iMessage on the agent's device because it uses device timezone.
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function startOfDayMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatThreadDividerIMessage(isoOrDate: string | Date, timeZone: string) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (!d || isNaN(d.getTime())) return "";

  const weekday = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    timeZone,
  }).format(d);

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(d);

  return `${weekday} ${time}`;
}

// ✅ normalize timestamp because API returns sentAt/createdAt not `date`
function getMsgIso(m: Message): string | undefined {
  return m.date || m.sentAt || m.createdAt || m.queuedAt;
}

function hasMsgId(list: Message[], msg: Message) {
  const id = (msg as any)?._id;
  if (!id) return false;
  return list.some((m: any) => m?._id && String(m._id) === String(id));
}

interface SuggestedReply {
  tone: string;
  content: string;
}

export default function ChatThread({ leadId, socket, mode = "sms" }: ChatThreadProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [emailMessages, setEmailMessages] = useState<EmailMsg[]>([]);
  const [input, setInput] = useState("");
  const [sendingSms, setSendingSms] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [suggestedReplies, setSuggestedReplies] = useState<SuggestedReply[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [resumingDrip, setResumingDrip] = useState(false);
  const [dripUi, setDripUi] = useState<{
    loading: boolean;
    hasActive: boolean;
    hasResumable: boolean;
  }>({
    loading: true,
    hasActive: false,
    hasResumable: false,
  });
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const timeZone = useMemo(() => getAgentTimeZone(), []);

  const scrollToBottom = () =>
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);

  const fetchMessages = async () => {
    if (!leadId) return;
    const res = await axios.get(`/api/message/${leadId}`);
    setMessages(res.data);
    scrollToBottom();

    // Mark inbound unread as read for this thread
    try {
      await axios.post("/api/messages/mark-read", { leadId });
    } catch (e) {
      console.warn("mark-read failed (fetch)", e);
    }
  };

  const fetchEmailMessages = async () => {
    if (!leadId) return;
    try {
      const res = await axios.get(`/api/email/threads/${leadId}`);
      setEmailMessages(res.data);
      scrollToBottom();
      // Pre-fill Re: subject from last outbound
      const last = [...res.data].reverse().find((m: EmailMsg) => m.subject);
      if (last?.subject) {
        setEmailSubject(last.subject.startsWith("Re:") ? last.subject : `Re: ${last.subject}`);
      }
    } catch (err) {
      console.error("Failed to load email thread", err);
    }
  };

  const fetchSuggestions = async () => {
    if (!leadId || emailMessages.length === 0) return;
    setLoadingSuggestions(true);
    setSuggestedReplies([]);
    try {
      const thread = emailMessages.slice(-6).map((m) => ({
        role: m.direction === "outbound" ? "agent" : "lead",
        content: m.subject || "(no subject)",
      }));
      const res = await axios.post("/api/ai/suggest-reply", {
        thread,
        channel: "email",
      });
      setSuggestedReplies(Array.isArray(res.data?.replies) ? res.data.replies : []);
    } catch {
      // silently fail
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const sendEmailReply = async () => {
    if (!emailBody.trim() || !emailSubject.trim()) return;
    setSendingEmail(true);
    try {
      await axios.post("/api/email/send-one", {
        leadId,
        subject: emailSubject.trim(),
        html: `<p>${emailBody.trim().replace(/\n/g, "</p><p>")}</p>`,
        text: emailBody.trim(),
      });
      setEmailBody("");
      setEmailSubject("");
      setSuggestedReplies([]);
      await fetchEmailMessages();
    } catch (err: any) {
      alert(err?.response?.data?.error || "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  };

  useEffect(() => {
    if (mode === "email") {
      fetchEmailMessages();
    } else {
      fetchMessages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, mode]);

  useEffect(() => {
    let cancelled = false;

    const fetchDripUi = async () => {
      if (!leadId) return;
      try {
        setDripUi((prev) => ({ ...prev, loading: true }));
        const res = await axios.get(`/api/drips/resume-status?leadId=${encodeURIComponent(leadId)}`);
        if (!cancelled) {
          setDripUi({
            loading: false,
            hasActive: !!res.data?.hasActive,
            hasResumable: !!res.data?.hasResumable,
          });
        }
      } catch {
        if (!cancelled) {
          setDripUi({
            loading: false,
            hasActive: false,
            hasResumable: false,
          });
        }
      }
    };

    fetchDripUi();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (message: Message) => {
      if (message.leadId === leadId) {
        setMessages((prev) => (hasMsgId(prev, message) ? prev : [...prev, message]));
        scrollToBottom();

        if (message.direction === "inbound") {
          axios.post("/api/messages/mark-read", { leadId }).catch(() => {});
        }
      }
    };


    const handleRead = (payload: { leadId?: string }) => {
      // If this thread was marked read elsewhere (another tab), you can optionally refresh.
      // Keeping this as a no-op avoids extra network calls.
      if (payload?.leadId === leadId) {
        // no-op
      }
    };

    socket.on("newMessage", handleNewMessage);

    const handleLegacyMessageNew = (payload: any) => {
      if (payload?.leadId === leadId) {
        // Legacy event: safest is to refetch from API
        fetchMessages();
      }
    };

    socket.on("message:new", handleLegacyMessageNew);

    socket.on("message:read", handleRead);
    return () => {
      socket.off("newMessage", handleNewMessage);
      socket.off("message:new", handleLegacyMessageNew);
      socket.off("message:read", handleRead);
    };
  }, [socket, leadId]);

  const sendMessage = async () => {
    const clean = input.trim();
    if (!clean || sendingSms) return;

    try {
      setSendingSms(true);

      const res = await axios.post("/api/message", {
        leadId,
        text: clean,
        direction: "outbound",
      });

      const message = res.data.message;
      setMessages((prev) => (hasMsgId(prev, message) ? prev : [...prev, message]));
      setInput("");
      scrollToBottom();
    } finally {
      setSendingSms(false);
    }
  };

  const handleContinueDrip = async () => {
    if (!leadId || resumingDrip || dripUi.hasActive) return;

    try {
      setResumingDrip(true);
      const res = await axios.post("/api/drips/resume-lead", { leadId });
      const campaignName = res?.data?.campaignName || "drip campaign";
      setDripUi({
        loading: false,
        hasActive: true,
        hasResumable: false,
      });
      alert(`✅ Continued ${campaignName}`);
    } catch (err: any) {
      console.error("Continue drip failed", err);
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.detail ||
        "Could not continue drip";
      alert(msg);
    } finally {
      setResumingDrip(false);
    }
  };

  // ── Email mode render ──────────────────────────────────────────────────────
  if (mode === "email") {
    return (
      <div className="flex flex-col h-full bg-[#0f172a]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 bg-[#0f172a] min-h-[56px] flex items-center justify-between">
          <span className="text-gray-400 text-sm">Email thread</span>
          {emailMessages.length > 0 && (
            <button
              onClick={fetchSuggestions}
              disabled={loadingSuggestions}
              className="text-xs bg-[#1e293b] border border-gray-600 text-blue-400 hover:text-blue-300 px-3 py-1 rounded-full disabled:opacity-60"
            >
              {loadingSuggestions ? "Thinking…" : "Suggest Replies"}
            </button>
          )}
        </div>

        {/* AI Reply Suggestions */}
        {suggestedReplies.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-800 bg-[#0f172a] space-y-2">
            <p className="text-xs text-gray-500 mb-1">AI Reply Suggestions</p>
            {suggestedReplies.map((r, i) => (
              <div
                key={i}
                className="border border-gray-700 rounded-lg p-2.5 bg-[#1e293b] flex items-start justify-between gap-2"
              >
                <div>
                  <span className="text-xs text-blue-400 font-medium capitalize mr-1">
                    {r.tone}:
                  </span>
                  <span className="text-xs text-gray-300">{r.content}</span>
                </div>
                <button
                  onClick={() => setEmailBody(r.content)}
                  className="text-xs text-green-400 hover:text-green-300 whitespace-nowrap ml-2"
                >
                  Use
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Email messages list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {emailMessages.length === 0 && (
            <div className="text-gray-500 text-sm text-center mt-10">
              No emails sent to this contact yet.
            </div>
          )}
          {emailMessages.map((msg) => {
            const dateStr = msg.sentAt || msg.createdAt;
            const date = dateStr ? new Date(dateStr) : null;
            const formattedDate =
              date && !isNaN(date.getTime())
                ? new Intl.DateTimeFormat(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                    timeZone,
                  }).format(date)
                : "";

            const badgeCls = STATUS_BADGE[msg.status] || "bg-gray-600 text-gray-200";
            const isInbound = msg.direction === "inbound";

            return (
              <div
                key={msg._id}
                className={`rounded-xl border p-3 ${
                  isInbound
                    ? "border-gray-600 bg-[#1e293b]"
                    : "border-gray-700 bg-[#162032]"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="font-medium text-white text-sm truncate">{msg.subject}</div>
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${badgeCls}`}>
                    {msg.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>{isInbound ? `From: ${msg.from}` : `To: ${msg.to}`}</span>
                  {formattedDate && (
                    <>
                      <span>·</span>
                      <span>{formattedDate}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Compose area */}
        <div className="border-t border-gray-800 p-4 space-y-2 bg-[#0f172a]">
          <input
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            placeholder="Subject"
            className="w-full bg-[#1e293b] border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
          <div className="flex gap-2">
            <textarea
              rows={3}
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              placeholder="Write your email…"
              className="flex-1 bg-[#1e293b] border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-600 resize-none"
            />
            <button
              onClick={sendEmailReply}
              disabled={sendingEmail || !emailBody.trim() || !emailSubject.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 rounded-lg text-sm font-medium disabled:opacity-60 self-end"
            >
              {sendingEmail ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── SMS mode render ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#0f172a]">
      <div className="flex items-center justify-end px-4 py-3 border-b border-gray-800 bg-[#0f172a] min-h-[72px]">
        {dripUi.hasActive ? (
          <span className="bg-green-700 text-white px-4 py-2 rounded-full text-sm">
            Drip Active
          </span>
        ) : dripUi.hasResumable ? (
          <button
            onClick={handleContinueDrip}
            disabled={resumingDrip}
            className="bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 transition disabled:opacity-60"
          >
            {resumingDrip ? "Continuing..." : "Continue Drip"}
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col">
        {messages.map((msg, idx) => {
          const isSent = msg.direction === "outbound" || msg.direction === "ai";
          const base =
            "px-4 py-2 rounded-2xl text-sm max-w-[75%] w-fit whitespace-pre-wrap break-words shadow";
          const alignment = isSent
            ? "self-end ml-auto text-white bg-green-600"
            : "self-start text-white bg-[#334155]";

          // ✅ use normalized timestamp
          const curIso = getMsgIso(msg);
          const prev = idx > 0 ? messages[idx - 1] : null;
          const prevIso = prev ? getMsgIso(prev) : undefined;

          const curDate = curIso ? new Date(curIso) : null;
          const prevDate = prevIso ? new Date(prevIso) : null;

          const curDay =
            curDate && !isNaN(curDate.getTime()) ? startOfDayMs(curDate) : null;
          const prevDay =
            prevDate && !isNaN(prevDate.getTime()) ? startOfDayMs(prevDate) : null;

          const showDivider =
            !!curDay && (idx === 0 || (prevDay !== null && curDay !== prevDay));

          return (
            <div key={idx} className="flex flex-col gap-2">
              {showDivider && (
                <div className="w-full flex justify-center py-1">
                  <span className="text-xs text-gray-300 bg-[#111827] border border-gray-700 rounded-full px-3 py-1">
                    {curIso ? formatThreadDividerIMessage(curIso, timeZone) : ""}
                  </span>
                </div>
              )}

              <div className={`${base} ${alignment}`}>{msg.text}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="p-4 border-t border-gray-800 flex gap-2 bg-[#0f172a]">
        <input
          className="flex-1 bg-[#1e293b] text-white border border-gray-700 rounded-full px-4 py-2 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-600"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!sendingSms) sendMessage();
            }
          }}
          placeholder="Type your message..."
        />
        <button
          onClick={sendMessage}
          disabled={sendingSms || !input.trim()}
          className="bg-green-600 text-white px-5 rounded-full hover:bg-green-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          {sendingSms ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
