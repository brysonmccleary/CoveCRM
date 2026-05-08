// pages/api/ai/generate-ad-images.ts
//
// POST — generate a real ad image asset using OpenAI gpt-image-1.
//
// This is the on-demand image generation/regeneration endpoint.
// The main generate-ad.ts generates images inline during campaign generation.
// This endpoint is called when the UI needs to regenerate a failed image
// or generate a standalone asset.
//
// Required env vars: OPENAI_API_KEY
//
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import OpenAI from "openai";

export const config = { maxDuration: 60 };

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Blueprint-matched fallback prompts per lead type.
// Used when the caller does not supply an imagePrompt.
// These are intentionally direct-response layouts, not lifestyle stock photos.
const FALLBACK_PROMPTS: Record<string, string> = {
  final_expense:
    "Direct-response Facebook ad creative background for final expense insurance, poster-style composition, premium dark gold layout, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, clean graphic background with space for overlay, no readable text inside image, NOT lifestyle photography, NO family-photo scene, no logos",
  veteran:
    "Direct-response veteran insurance ad creative background, bold patriotic poster composition, navy and gold graphic areas, American flag texture background, veteran-aged civilian male, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, NOT lifestyle photography, NO kids, NO family portraits, NO military uniforms, NO official insignia, NO government seals, no logos",
  mortgage_protection:
    "Direct-response mortgage protection ad creative background, home-focused poster layout, house and key visual, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, clean graphic background with space for overlay, no readable text inside image, high contrast red white navy palette, NOT lifestyle stock photography, NOT paperwork table scene, no logos",
  iul:
    "Premium direct-response IUL education ad creative background, blue gold white clean graphic layout, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, clean background with space for overlay, no readable text inside image, NOT lifestyle stock-photo style, no logos",
  trucker:
    "Direct-response trucker insurance ad creative background, large semi truck hero image on highway, poster composition, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, clean graphic background with space for overlay, no readable text inside image, high contrast neon amber blue or patriotic palette, NOT stock-photo style, NO home-family scenes, no logos",
};

const SAFE_PUBLIC_ERROR =
  "We couldn’t generate the campaign image right now. Please try again.";

function getSafePublicError() {
  return SAFE_PUBLIC_ERROR;
}

function sanitizeImagePrompt(prompt: string, leadType: string) {
  let sanitized = String(prompt || "");
  const replacements: Array<[RegExp, string]> = [
    [/family at home/gi, "structured direct-response ad layout"],
    [/mature family/gi, "single veteran-aged civilian subject"],
    [/young family/gi, "home-focused visual"],
    [/smiling family/gi, "structured benefit-card visual"],
    [/couple at home/gi, "home-focused visual"],
    [/couple reviewing paperwork/gi, "clean graphic background with space for overlay"],
    [/kitchen table/gi, "blank reserved CTA/button area for app-rendered UI"],
    [/cozy home/gi, "premium direct-response layout"],
    [/warm natural lighting/gi, "high-contrast direct-response lighting"],
    [/warm realistic lighting/gi, "high-contrast direct-response lighting"],
    [/warm cinematic/gi, "high-contrast direct-response"],
    [/candid family photography/gi, "poster-style ad creative"],
    [/realistic photography/gi, "graphic direct-response ad composition"],
    [/structured typography zones/gi, "blank reserved headline area for app-rendered text"],
    [/age or coverage selection buttons/gi, "blank reserved CTA/button area for app-rendered UI"],
    [/fake clickable (?:option )?buttons?/gi, "blank reserved CTA/button area for app-rendered UI"],
    [/amount card layout/gi, "clean graphic background with space for overlay"],
    [/amount-card layout/gi, "clean graphic background with space for overlay"],
    [/benefit-card composition/gi, "clean graphic background with space for overlay"],
    [/benefit-card visual/gi, "clean graphic background with space for overlay"],
    [/strong headline area/gi, "blank reserved headline area for app-rendered text"],
    [/bold headline zone/gi, "blank reserved headline area for app-rendered text"],
    [/clean CTA layout/gi, "blank reserved CTA/button area for app-rendered UI"],
  ];

  if (leadType === "veteran") {
    replacements.push(
      [/children/gi, "coverage cards"],
      [/kids/gi, "coverage cards"],
      [/family portraits?/gi, "patriotic poster composition"]
    );
  }

  if (leadType === "trucker") {
    replacements.push([/family/gi, "semi truck hero visual"]);
  }

  for (const [pattern, replacement] of replacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { leadType, imagePrompt } = req.body as { leadType?: string; imagePrompt?: string };

  if (!leadType) return res.status(400).json({ error: "leadType is required" });

  if (!openai) {
    return res.status(503).json({ ok: false, error: getSafePublicError() });
  }

  const rawImagePrompt = String(imagePrompt || "").trim();
  const fallbackPrompt = FALLBACK_PROMPTS[leadType] || FALLBACK_PROMPTS.mortgage_protection;

  if (!rawImagePrompt) {
    console.warn("[generate-ad-images] Missing imagePrompt; using direct-response fallback", { leadType });
  }

  const prompt = sanitizeImagePrompt(
    rawImagePrompt || fallbackPrompt,
    leadType
  ).trim();

  try {
    const img = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const item = img.data?.[0];
    const imageUrl =
      typeof item?.url === "string" && item.url.trim()
        ? item.url.trim()
        : typeof item?.b64_json === "string" && item.b64_json.trim()
        ? `data:image/png;base64,${item.b64_json.trim()}`
        : null;

    if (!imageUrl) {
      console.error("[generate-ad-images] No usable asset returned", {
        hasData: Array.isArray(img.data),
        itemCount: Array.isArray(img.data) ? img.data.length : 0,
        hasUrl: !!item?.url,
        hasB64Json: !!item?.b64_json,
        topLevelKeys:
          img && typeof img === "object"
            ? Object.keys(img as unknown as Record<string, unknown>)
            : [],
      });
      return res.status(500).json({ ok: false, error: getSafePublicError() });
    }

    return res.status(200).json({ ok: true, imageUrl, prompt });
  } catch (err: any) {
    const errorMessage = err?.message || "Image generation failed";
    const responseData = err?.response?.data;
    console.error("[generate-ad-images] OpenAI error", {
      message: errorMessage,
      responseKeys:
        responseData && typeof responseData === "object"
          ? Object.keys(responseData as Record<string, unknown>)
          : [],
      hasData: Array.isArray(responseData?.data),
      hasUrl: !!responseData?.data?.[0]?.url,
      hasB64Json: !!responseData?.data?.[0]?.b64_json,
    });
    return res.status(500).json({ ok: false, error: getSafePublicError() });
  }
}
