// pages/api/ai/generate-ad-images.ts
// POST — curated Unsplash stock photos only (no DALL-E)
// Required env vars:
//   UNSPLASH_ACCESS_KEY — Get free key at unsplash.com/developers → create app → copy Access Key
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import axios from "axios";

export const config = { maxDuration: 30 };

const UNSPLASH_QUERIES: Record<string, string> = {
  final_expense: "senior couple at home warm lighting",
  veteran: "american flag family home lifestyle patriotic",
  mortgage_protection: "family standing in front of suburban house",
  iul: "professional couple modern home office financial planning",
  trucker: "semi truck on highway at sunset america",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { leadType } = req.body as { leadType?: string; agentName?: string; agentState?: string };

  if (!leadType) return res.status(400).json({ error: "leadType is required" });

  const unsplashQuery = UNSPLASH_QUERIES[leadType] ?? "insurance family home";

  // ── Fetch 9 Unsplash photos, randomly return 5 ───────────────────────────
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
        timeout: 10000,
      });

      const results: any[] = unsplashRes.data?.results ?? [];

      // Shuffle and pick 5
      const shuffled = results.sort(() => Math.random() - 0.5).slice(0, 5);
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
    stockPhotos,
    recommendedSize: "1200x628px for feed ads, 1080x1080px for square format",
  });
}
