import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";

const CLARITY_ENDPOINT =
  "https://www.clarity.ms/export-data/api/v1/project-live-insights";

type ClarityMetricBlock = {
  metricName?: string;
  information?: Array<Record<string, unknown>>;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeMetricName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getMetricBlock(
  blocks: ClarityMetricBlock[],
  names: string[],
): ClarityMetricBlock | null {
  const wanted = new Set(names.map((name) => normalizeMetricName(name)));
  return (
    blocks.find((block) => wanted.has(normalizeMetricName(block.metricName))) ||
    null
  );
}

function rowsFor(block: ClarityMetricBlock | null): Array<Record<string, unknown>> {
  return Array.isArray(block?.information) ? block!.information! : [];
}

function sumField(
  rows: Array<Record<string, unknown>>,
  candidates: string[],
): number {
  return rows.reduce((total, row) => {
    for (const key of candidates) {
      if (row[key] != null) return total + toNumber(row[key]);
    }
    return total;
  }, 0);
}

function firstPresentNumber(
  row: Record<string, unknown>,
  candidates: string[],
): number {
  for (const key of candidates) {
    if (row[key] != null) return toNumber(row[key]);
  }
  return 0;
}

function firstPresentString(
  row: Record<string, unknown>,
  candidates: string[],
): string {
  for (const key of candidates) {
    const value = row[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function summarizeDevices(
  rows: Array<Record<string, unknown>>,
  trafficRows: Array<Record<string, unknown>>,
) {
  const sourceRows = rows.length ? rows : trafficRows;
  const grouped = new Map<string, number>();

  for (const row of sourceRows) {
    const device = firstPresentString(row, ["Device", "device"]) || "Unknown";
    const trafficValue = firstPresentNumber(row, [
      "totalSessionCount",
      "sessionCount",
      "traffic",
      "Traffic",
      "visitors",
      "Visitors",
    ]);
    grouped.set(device, (grouped.get(device) || 0) + trafficValue);
  }

  const items = Array.from(grouped.entries())
    .map(([device, traffic]) => ({ device, traffic }))
    .sort((a, b) => b.traffic - a.traffic);

  const mobile = items
    .filter((item) => /mobile|android|ios|phone/i.test(item.device))
    .reduce((sum, item) => sum + item.traffic, 0);
  const desktop = items
    .filter((item) => /desktop|windows|mac|linux/i.test(item.device))
    .reduce((sum, item) => sum + item.traffic, 0);

  return {
    breakdown: items,
    mobile,
    desktop,
  };
}

function summarizeTopUrls(rows: Array<Record<string, unknown>>) {
  return rows
    .map((row) => ({
      url:
        firstPresentString(row, ["URL", "Url", "url", "Page URL", "PageUrl"]) ||
        "Unknown URL",
      traffic: firstPresentNumber(row, [
        "totalSessionCount",
        "sessionCount",
        "traffic",
        "Traffic",
        "visitors",
        "Visitors",
      ]),
    }))
    .filter((item) => item.traffic > 0)
    .sort((a, b) => b.traffic - a.traffic)
    .slice(0, 8);
}

function summarizeClarity(blocks: ClarityMetricBlock[]) {
  const trafficBlock = getMetricBlock(blocks, ["Traffic"]);
  const engagementBlock = getMetricBlock(blocks, ["Engagement Time"]);
  const scrollBlock = getMetricBlock(blocks, ["Scroll Depth"]);
  const rageBlock = getMetricBlock(blocks, ["Rage Click Count"]);
  const deadBlock = getMetricBlock(blocks, ["Dead Click Count"]);

  const trafficRows = rowsFor(trafficBlock);
  const engagementRows = rowsFor(engagementBlock);
  const scrollRows = rowsFor(scrollBlock);
  const rageRows = rowsFor(rageBlock);
  const deadRows = rowsFor(deadBlock);

  const topUrls = summarizeTopUrls(trafficRows);
  const deviceSummary = summarizeDevices(engagementRows, trafficRows);

  const visitors = sumField(trafficRows, [
    "totalSessionCount",
    "sessionCount",
    "traffic",
    "Traffic",
    "visitors",
    "Visitors",
  ]);
  const uniqueVisitors = sumField(trafficRows, [
    "distinctUserCount",
    "distantUserCount",
    "uniqueVisitors",
    "uniqueUserCount",
  ]);
  const engagementTime = sumField(engagementRows, [
    "engagementTime",
    "EngagementTime",
    "totalEngagementTime",
    "TotalEngagementTime",
    "averageEngagementTime",
  ]);
  const scrollDepth = sumField(scrollRows, [
    "scrollDepth",
    "ScrollDepth",
    "averageScrollDepth",
    "AverageScrollDepth",
  ]);
  const rageClicks = sumField(rageRows, [
    "rageClickCount",
    "RageClickCount",
    "count",
    "Count",
  ]);
  const deadClicks = sumField(deadRows, [
    "deadClickCount",
    "DeadClickCount",
    "count",
    "Count",
  ]);

  return {
    summary: {
      visitors,
      uniqueVisitors,
      engagementTime,
      scrollDepth,
      rageClicks,
      deadClicks,
    },
    topUrls,
    devices: deviceSummary,
    metricNames: blocks.map((block) => String(block.metricName || "")).filter(Boolean),
    hasData:
      visitors > 0 ||
      engagementTime > 0 ||
      scrollDepth > 0 ||
      rageClicks > 0 ||
      deadClicks > 0 ||
      topUrls.length > 0,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const email = String(session?.user?.email || "").toLowerCase();
  if (!isExperimentalAdminEmail(email)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const token = String(process.env.CLARITY_API_TOKEN || "").trim();
  if (!token) {
    return res.status(500).json({
      error: "CLARITY_API_TOKEN is not configured.",
      waiting: true,
    });
  }

  const params = new URLSearchParams({
    numOfDays: "1",
    dimension1: "URL",
    dimension2: "Device",
  });

  try {
    const response = await fetch(`${CLARITY_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message =
        parsed?.message ||
        parsed?.error ||
        `Clarity request failed with ${response.status}`;
      return res.status(response.status).json({
        error: message,
        waiting: response.status === 401 || response.status === 403 ? false : true,
      });
    }

    const blocks = Array.isArray(parsed) ? (parsed as ClarityMetricBlock[]) : [];
    if (!blocks.length) {
      return res.status(200).json({
        waiting: true,
        error: "Clarity has no data yet for the last day.",
        summary: null,
        topUrls: [],
        devices: { breakdown: [], mobile: 0, desktop: 0 },
        metricNames: [],
      });
    }

    const result = summarizeClarity(blocks);
    if (!result.hasData) {
      return res.status(200).json({
        waiting: true,
        error: "Waiting for Clarity data from the last day.",
        summary: result.summary,
        topUrls: result.topUrls,
        devices: result.devices,
        metricNames: result.metricNames,
      });
    }

    return res.status(200).json({
      waiting: false,
      summary: result.summary,
      topUrls: result.topUrls,
      devices: result.devices,
      metricNames: result.metricNames,
      responseShape:
        "Expected Clarity response: array of { metricName: string, information: object[] } blocks.",
    });
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || "Failed to load Clarity insights.",
      waiting: true,
    });
  }
}
