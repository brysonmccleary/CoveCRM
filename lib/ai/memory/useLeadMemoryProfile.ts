"use client";

import { useEffect, useState } from "react";

export type LeadMemoryProfileView = {
  shortSummary?: string;
  nextBestAction?: string;
  objections?: string[];
  preferences?: Record<string, any>;
  lastUpdatedAt?: string;
  keyFacts?: { key: string; value: string; confidence?: number }[];
};

const profileCache = new Map<string, LeadMemoryProfileView | null>();

export function useLeadMemoryProfile(leadId?: string | null) {
  const normalizedLeadId = String(leadId || "").trim();
  const [profile, setProfile] = useState<LeadMemoryProfileView | null>(
    normalizedLeadId && profileCache.has(normalizedLeadId)
      ? profileCache.get(normalizedLeadId) ?? null
      : null
  );

  useEffect(() => {
    if (!normalizedLeadId) {
      setProfile(null);
      return;
    }

    if (profileCache.has(normalizedLeadId)) {
      setProfile(profileCache.get(normalizedLeadId) ?? null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const r = await fetch(
          `/api/ai/memory/profile?leadId=${encodeURIComponent(normalizedLeadId)}`,
          { cache: "no-store" }
        );
        const j = await r.json().catch(() => ({} as any));
        const nextProfile = r.ok ? j?.profile || null : null;
        profileCache.set(normalizedLeadId, nextProfile);
        if (!cancelled) setProfile(nextProfile);
      } catch {
        profileCache.set(normalizedLeadId, null);
        if (!cancelled) setProfile(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [normalizedLeadId]);

  return profile;
}
