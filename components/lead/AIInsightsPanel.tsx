"use client";

import { useEffect, useMemo, useState } from "react";
import { useLeadMemoryProfile } from "@/lib/ai/memory/useLeadMemoryProfile";

type LeadLike = {
  id?: string;
  _id?: string;
  firstName?: string;
  ["First Name"]?: string;
  aiPriorityScore?: number;
  aiPriorityCategory?: "hot" | "warm" | "cold" | string;
  [key: string]: any;
};

type HistoryEvent =
  | {
      type: "sms";
      id: string;
      dir: "inbound" | "outbound" | "ai";
      text: string;
      date: string;
    }
  | {
      type: "call";
      id: string;
      date: string;
    }
  | {
      type: string;
      id: string;
      date: string;
      [key: string]: any;
    };

function formatDateTime(value?: string | Date | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function firstNameFromLead(lead: LeadLike | null) {
  const first = String(lead?.firstName || lead?.["First Name"] || "").trim();
  return first || "there";
}

function isReactivationMessage(text: string) {
  const normalized = String(text || "").toLowerCase();
  return normalized.includes("timing can change") || normalized.includes("checking back in");
}

function priorityBadgeClasses(category: string) {
  const normalized = String(category || "cold").toLowerCase();
  if (normalized === "hot") return "bg-red-500/15 text-red-300 border border-red-500/30";
  if (normalized === "warm") return "bg-orange-500/15 text-orange-300 border border-orange-500/30";
  return "bg-gray-500/15 text-gray-300 border border-gray-500/30";
}

function priorityLabel(category: string) {
  const normalized = String(category || "cold").toLowerCase();
  if (normalized === "hot") return "Hot";
  if (normalized === "warm") return "Warm";
  return "Cold";
}

export default function AIInsightsPanel({ lead }: { lead: LeadLike | null }) {
  const leadId = String(lead?.id || lead?._id || "").trim();
  const memoryProfile = useLeadMemoryProfile(leadId) as
    | {
        shortSummary?: string;
        longSummary?: string;
        nextBestAction?: string;
      }
    | null;
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!leadId) {
      setHistory([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoadingHistory(true);
        const response = await fetch(
          `/api/leads/history?id=${encodeURIComponent(leadId)}&limit=100&includeCalls=1`,
          { cache: "no-store" }
        );
        const json = await response.json().catch(() => ({} as any));
        if (cancelled) return;
        setHistory(Array.isArray(json?.events) ? json.events : []);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const smsEvents = useMemo(
    () => history.filter((event): event is Extract<HistoryEvent, { type: "sms" }> => event.type === "sms"),
    [history]
  );
  const callEvents = useMemo(
    () => history.filter((event): event is Extract<HistoryEvent, { type: "call" }> => event.type === "call"),
    [history]
  );

  const lastSmsDate = smsEvents[0]?.date || null;
  const lastCallDate = callEvents[0]?.date || null;

  const lastSuggestedMessage = useMemo(() => {
    const latestOutbound = smsEvents.find(
      (event) =>
        (event.dir === "outbound" || event.dir === "ai") &&
        String(event.text || "").trim()
    );
    return latestOutbound?.text?.trim() || "";
  }, [smsEvents]);

  const lastAIFollowUpDate = useMemo(() => {
    const latestFollowup = smsEvents.find((event) => {
      if (!(event.dir === "outbound" || event.dir === "ai")) return false;
      const text = String(event.text || "").trim();
      if (!text) return false;
      return !isReactivationMessage(text);
    });
    return latestFollowup?.date || null;
  }, [smsEvents]);

  const lastReactivationDate = useMemo(() => {
    const latestReactivation = smsEvents.find((event) => {
      if (!(event.dir === "outbound" || event.dir === "ai")) return false;
      return isReactivationMessage(event.text || "");
    });
    return latestReactivation?.date || null;
  }, [smsEvents]);

  const summary =
    String(memoryProfile?.shortSummary || memoryProfile?.longSummary || "").trim() ||
    "No AI summary yet";
  const nextBestAction =
    String(memoryProfile?.nextBestAction || "").trim() || "No next action yet";

  const priorityCategory = String(lead?.aiPriorityCategory || "cold").toLowerCase();
  const priorityScore = Number.isFinite(Number(lead?.aiPriorityScore))
    ? Number(lead?.aiPriorityScore)
    : 0;

  const scheduledFollowup = "Not scheduled";
  const scheduledReactivation = "Not scheduled";

  return (
    <div className="rounded-xl border border-white/10 bg-[#111827] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <h3 className="text-lg font-bold text-white">AI Insights</h3>
      </div>

      <div className="px-4 py-4 border-b border-white/10">
        <div className="text-xs uppercase tracking-[0.18em] text-gray-400 mb-3">AI Priority</div>
        <div className="flex items-center gap-3">
          <div className={`px-4 py-2 rounded-xl text-base font-semibold ${priorityBadgeClasses(priorityCategory)}`}>
            {priorityLabel(priorityCategory)}
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{priorityScore}</div>
            <div className="text-xs text-gray-400">Priority score</div>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 border-b border-white/10">
        <div className="text-xs uppercase tracking-[0.18em] text-gray-400 mb-2">AI Summary</div>
        <p className="text-sm text-gray-200 leading-6">{summary}</p>
      </div>

      <div className="px-4 py-4 border-b border-white/10">
        <div className="text-xs uppercase tracking-[0.18em] text-gray-400 mb-2">Next Best Action</div>
        <p className="text-sm text-gray-200 leading-6">{nextBestAction}</p>
      </div>

      <div className="px-4 py-4 border-b border-white/10">
        <div className="text-xs uppercase tracking-[0.18em] text-gray-400 mb-3">AI Activity</div>
        <div className="space-y-2 text-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="text-gray-400">Last SMS</span>
            <span className="text-right text-gray-200">{formatDateTime(lastSmsDate)}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-gray-400">Last Call</span>
            <span className="text-right text-gray-200">{formatDateTime(lastCallDate)}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-gray-400">Last AI Follow-up</span>
            <span className="text-right text-gray-200">{formatDateTime(lastAIFollowUpDate)}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-gray-400">Last Reactivation</span>
            <span className="text-right text-gray-200">{formatDateTime(lastReactivationDate)}</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="text-xs uppercase tracking-[0.18em] text-gray-400 mb-3">Scheduled Actions</div>
        <div className="space-y-2 text-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="text-gray-400">Next Follow-up Scheduled</span>
            <span className="text-right text-gray-200">{scheduledFollowup}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-gray-400">Next Reactivation Scheduled</span>
            <span className="text-right text-gray-200">{scheduledReactivation}</span>
          </div>
        </div>

        {loadingHistory ? (
          <div className="mt-3 text-xs text-gray-500">Loading AI activity…</div>
        ) : null}
      </div>
    </div>
  );
}
