// pages/api/calls/top-objections.ts
// GET — aggregate top objections from CallCoachReport records by date range
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import CallCoachReport from "@/models/CallCoachReport";
import ObjectionEntry from "@/models/ObjectionEntry";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  await mongooseConnect();

  const userEmail = session.user.email.toLowerCase();
  const range = (req.query.range as string) || "7days";

  const now = new Date();
  let since: Date;
  if (range === "today") {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (range === "30days") {
    since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    // default 7days
    since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  try {
    // Fetch reports in date range
    const reports = await CallCoachReport.find({
      userEmail,
      generatedAt: { $gte: since },
    })
      .select("objectionsEncountered")
      .lean();

    // Aggregate objections by text (case-insensitive)
    const counts = new Map<string, { canonical: string; count: number }>();
    for (const report of reports) {
      const objections = (report as any).objectionsEncountered || [];
      for (const obj of objections) {
        const text = String(obj.objection || "").trim();
        if (!text) continue;
        const key = text.toLowerCase();
        const existing = counts.get(key);
        if (existing) {
          existing.count++;
        } else {
          counts.set(key, { canonical: text, count: 1 });
        }
      }
    }

    // Sort by count, take top 3
    const sorted = Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    if (sorted.length === 0) {
      return res.status(200).json({ objections: [], range, since });
    }

    // Try to match each objection to an ObjectionEntry for a suggested response
    let objectionEntries: any[] = [];
    try {
      objectionEntries = await (ObjectionEntry as any)
        .find({ $or: [{ userEmail }, { userEmail: null }, { userEmail: { $exists: false } }] })
        .select("objection suggestedResponse")
        .lean();
    } catch {
      // ObjectionEntry may not exist
    }

    const result = sorted.map((item) => {
      // Find best matching objection entry
      let suggestedResponse: string | null = null;
      const searchKey = item.canonical.toLowerCase();
      for (const entry of objectionEntries) {
        const entryText = String(entry.objection || "").toLowerCase();
        // Simple substring or word overlap match
        if (entryText.includes(searchKey.slice(0, 20)) || searchKey.includes(entryText.slice(0, 20))) {
          suggestedResponse = String(entry.suggestedResponse || "") || null;
          break;
        }
      }
      return {
        objection: item.canonical,
        count: item.count,
        suggestedResponse,
      };
    });

    return res.status(200).json({ objections: result, range, since });
  } catch (err: any) {
    console.error("[top-objections]", err?.message);
    return res.status(500).json({ message: "Failed to load objections" });
  }
}
