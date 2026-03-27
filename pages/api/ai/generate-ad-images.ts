// pages/api/ai/generate-ad-images.ts
// POST — generate DALL-E 3 ad images + curated Unsplash stock photos for a lead type
// Required env vars:
//   OPENAI_API_KEY     — OpenAI API key
//   UNSPLASH_ACCESS_KEY — Get free key at unsplash.com/developers → create app → copy Access Key
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import OpenAI from "openai";
import axios from "axios";

export const config = { maxDuration: 60 };

const DALLE_PROMPTS: Record<string, (state: string) => string[]> = {
  final_expense: (s) => [
    `A warm, genuine lifestyle photo of a smiling senior couple in their 70s sitting together at a kitchen table in a comfortable home in ${s}. Natural lighting, photorealistic, not staged. No text overlay.`,
    `A multigenerational family scene — grandparents with adult children and grandchildren — gathered in a living room in ${s}. Warm lighting, authentic smiles, photorealistic. No text overlay.`,
  ],
  veteran: (s) => [
    `A dignified older American veteran in civilian clothes, smiling warmly with his family in a backyard in ${s}. American flag subtly visible in background. Authentic, photorealistic. No text overlay.`,
    `An older veteran couple sitting on a porch together in ${s}, smiling contentedly. American flag nearby. Warm, photorealistic lifestyle photo. No text overlay.`,
  ],
  mortgage_protection: (s) => [
    `A happy young couple holding house keys in front of their first home in a suburban neighborhood in ${s}. Sunny day, genuine smiles, photorealistic lifestyle photo. No text overlay.`,
    `A young family — couple with one or two small children — standing in front of a new home in ${s}. Warm sunlight, authentic expressions, photorealistic. No text overlay.`,
  ],
  iul: (s) => [
    `A confident professional in their 40s sitting across from a financial advisor at a desk in a modern office in ${s}, both smiling. Warm lighting, photorealistic. No text overlay.`,
    `A successful couple in their 40s reviewing financial documents together at a kitchen table in ${s}. Happy and relaxed. Photorealistic lifestyle photo. No text overlay.`,
  ],
  trucker: (s) => [
    `A proud truck driver standing next to his semi truck on an open highway in ${s}, smiling confidently, wearing a work jacket. Photorealistic, authentic. No text overlay.`,
    `A trucker and his family outside their home in ${s} — the truck visible in the driveway. Warm, authentic family photo. Photorealistic. No text overlay.`,
  ],
};

const UNSPLASH_QUERIES: Record<string, string> = {
  final_expense: "senior couple happy home",
  veteran: "american veteran family",
  mortgage_protection: "couple new home keys",
  iul: "financial planning family",
  trucker: "truck driver highway",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { leadType, agentName, agentState } = req.body as {
    leadType?: string;
    agentName?: string;
    agentState?: string;
  };

  if (!leadType) return res.status(400).json({ error: "leadType is required" });

  const state = agentState || "your state";
  const prompts = DALLE_PROMPTS[leadType]?.(state) ?? DALLE_PROMPTS["final_expense"](state);
  const unsplashQuery = UNSPLASH_QUERIES[leadType] ?? "insurance family";

  // ── Step A: Generate 2 DALL-E 3 images ──────────────────────────────────────
  const aiImages: { url: string; revised_prompt: string }[] = [];

  if (process.env.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    for (const prompt of prompts) {
      try {
        const imgRes = await openai.images.generate({
          model: "dall-e-3",
          prompt,
          size: "1792x1024",
          quality: "standard",
          n: 1,
        });
        const imgData = imgRes.data?.[0];
        if (imgData?.url) {
          aiImages.push({
            url: imgData.url,
            revised_prompt: imgData.revised_prompt ?? prompt,
          });
        }
      } catch (err: any) {
        console.warn("[generate-ad-images] DALL-E error:", err?.message);
      }
    }
  }

  // ── Step B: Fetch 9 Unsplash photos, return 3 random ────────────────────────
  const stockPhotos: {
    url: string;
    downloadUrl: string;
    photographer: string;
    unsplashLink: string;
  }[] = [];

  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const unsplashRes = await axios.get("https://api.unsplash.com/search/photos", {
        params: {
          query: unsplashQuery,
          per_page: 9,
          orientation: "landscape",
        },
        headers: {
          Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
        },
        timeout: 8000,
      });

      const results: any[] = unsplashRes.data?.results ?? [];

      // Shuffle and pick 3
      const shuffled = results.sort(() => Math.random() - 0.5).slice(0, 3);
      for (const photo of shuffled) {
        stockPhotos.push({
          url: photo.urls?.regular ?? photo.urls?.small ?? "",
          downloadUrl: photo.links?.download ?? photo.urls?.full ?? "",
          photographer: photo.user?.name ?? "Unsplash",
          unsplashLink: photo.links?.html ?? "https://unsplash.com",
        });
      }
    } catch (err: any) {
      console.warn("[generate-ad-images] Unsplash error:", err?.message);
    }
  }

  return res.status(200).json({
    aiImages,
    stockPhotos,
    recommendedSize: "1200x628px for feed ads, 1080x1080px for square format",
  });
}
