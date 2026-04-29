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
// Each matches the PRIMARY archetype visual direction from creativeStyleRules.ts.
const FALLBACK_PROMPTS: Record<string, string> = {
  final_expense:
    "Vertical 9:16 ad image, multigenerational family in cozy home, warm realistic lighting, near-black and gold warm color palette, dignified and trustworthy, no logos, no text overlay",
  veteran:
    "Vertical 9:16 ad image, veteran-aged civilian with family at home, patriotic red and blue color palette, respectful, civilian setting, no military uniforms, no official insignia, no logos, no text overlay",
  mortgage_protection:
    "Vertical 9:16 ad image, happy couple in front of their suburban home, warm coral red and white natural lighting, family-safe, middle-American neighborhood feel, no logos, no text overlay",
  iul:
    "Vertical 9:16 ad image, professional couple reviewing finances at modern table, premium blue and gold and white palette, clean executive feel, home office setting, no logos, no text overlay",
  trucker:
    "Vertical 9:16 ad image, commercial semi truck on open American highway at golden hour, warm amber and red Americana palette, rugged and strong, wide shot, no logos, no text overlay",
};

const SAFE_PUBLIC_ERROR =
  "We couldn’t generate the campaign image right now. Please try again.";

function getSafePublicError() {
  return SAFE_PUBLIC_ERROR;
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

  const prompt = String(
    imagePrompt || FALLBACK_PROMPTS[leadType] || FALLBACK_PROMPTS.mortgage_protection
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
