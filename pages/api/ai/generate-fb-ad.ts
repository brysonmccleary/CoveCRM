// pages/api/ai/generate-fb-ad.ts
// Compatibility wrapper — delegates to /api/facebook/generate-ad (source of truth)
// Accepts legacy params (agentName, agentState, tone, targetAge, mode) and
// maps them to generate-ad params, returning a normalized response.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const {
    leadType = "mortgage_protection",
    agentName,
    agentState,
    tone,
    targetAge,
    mode,
    location,
    dailyBudget,
    gender,
    ageMin,
    ageMax,
  } = req.body as {
    leadType?: string;
    agentName?: string;
    agentState?: string;
    tone?: string;
    targetAge?: string;
    mode?: string;
    location?: string;
    dailyBudget?: number;
    gender?: string;
    ageMin?: number;
    ageMax?: number;
  };

  // Map legacy targetAge "50-70" → ageMin/ageMax
  let resolvedAgeMin = ageMin;
  let resolvedAgeMax = ageMax;
  if (!resolvedAgeMin && !resolvedAgeMax && targetAge) {
    const parts = String(targetAge).split("-");
    resolvedAgeMin = parseInt(parts[0] ?? "30", 10) || 30;
    resolvedAgeMax = parseInt(parts[1] ?? "65", 10) || 65;
  }

  // Use agentState as location if no explicit location provided
  const resolvedLocation = location || agentState || "";

  try {
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers["host"] || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    const upstream = await fetch(`${baseUrl}/api/facebook/generate-ad`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward session cookie so the upstream auth check passes
        cookie: req.headers.cookie || "",
      },
      body: JSON.stringify({
        leadType,
        location: resolvedLocation,
        dailyBudget: dailyBudget ?? 25,
        gender: gender ?? "all",
        ageMin: resolvedAgeMin ?? 30,
        ageMax: resolvedAgeMax ?? 65,
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json(data);
    }

    const draft = data?.draft ?? data;

    // Return normalized response — spread draft fields at top level for legacy callers
    // that may expect headlines/primaryTexts arrays, plus preserve full draft object.
    return res.status(200).json({
      ok: true,
      mode: mode || "standard",
      // Legacy array fields for any callers that iterate headlines/primaryTexts
      headlines: draft.headline ? [draft.headline] : [],
      primaryTexts: draft.primaryText ? [draft.primaryText] : [],
      cta: draft.cta || "LEARN_MORE",
      // Full draft passthrough
      draft,
      // Top-level convenience fields matching CompleteAdPackage shape
      hook: draft.hook || "",
      primaryText: draft.primaryText || "",
      headline: draft.headline || "",
      description: draft.description || "",
      imagePrompt: draft.imagePrompt || "",
      targeting: draft.targeting || {},
      estimatedCpl: "",
      reasoning: "",
      // Creative archetype fields
      creativeArchetype: draft.creativeArchetype || null,
      overlayTemplate: draft.overlayTemplate || null,
      overlayData: draft.overlayData || null,
      variants: draft.variants || [],
      copySource: draft.copySource || "template_fallback",
    });
  } catch (err: any) {
    console.error("[generate-fb-ad] wrapper error:", err?.message);
    return res.status(500).json({ error: "Ad generation failed" });
  }
}
