// pages/api/drips/campaigns.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";

/**
 * GET:
 *   Returns all SMS drip campaigns visible to the current user:
 *    - User-scoped campaigns (`user` / `userEmail` = session email)
 *    - Any global campaigns (`isGlobal: true`)
 *
 *   Query params:
 *     - active=1   -> only return isActive === true
 *
 *   Response shape (backwards compatible):
 *     { campaigns: [{ _id, name, key, isActive, steps?, isGlobal?, createdBy?, user? }] }
 *
 * POST:
 *   Creates a new custom SMS drip campaign for the current user, active by default.
 *   Body:
 *     - name: string
 *     - steps: Array<{ text: string; day?: string; time?: string }>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return handleGet(req, res);
  }
  if (req.method === "POST") {
    return handlePost(req, res);
  }

  res.setHeader("Allow", "GET,POST");
  return res.status(405).json({ error: "Method Not Allowed" });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await dbConnect();

    const activeOnly = ["1", "true", "yes"].includes(
      String(req.query.active || "").toLowerCase()
    );

    const email = String(session.user.email).toLowerCase();

    // Respect multi-tenant scoping AND include any global campaigns.
    const scopeOr = [
      { user: email },
      { userEmail: email },
      { isGlobal: true },
    ];

    const query: any = {
      type: "sms",
      $or: scopeOr,
    };
    if (activeOnly) query.isActive = true;

    const campaigns = await DripCampaign.find(query)
      .select({
        _id: 1,
        name: 1,
        key: 1,
        isActive: 1,
        steps: 1,
        isGlobal: 1,
        createdBy: 1,
        user: 1,
        userEmail: 1,
      })
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      campaigns: campaigns.map((c: any) => ({
        _id: String(c._id),
        name: c.name,
        key: c.key,
        isActive: Boolean(c.isActive),
        // extra fields (safe for new UI consumers)
        steps: Array.isArray(c.steps) ? c.steps : [],
        isGlobal: Boolean(c.isGlobal),
        createdBy: c.createdBy || null,
        user: c.user || null,
        userEmail: c.userEmail || null,
      })),
    });
  } catch (err: any) {
    console.error("[drips/campaigns GET] error", err);
    return res
      .status(500)
      .json({ error: "Server error", detail: err?.message || "Unknown error" });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await dbConnect();

    const { name, steps } = (req.body || {}) as {
      name?: string;
      steps?: Array<{ text?: string; day?: string; time?: string }>;
    };

    if (!name || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({
        error: "Missing required fields: name and at least one step",
      });
    }

    const email = String(session.user.email).toLowerCase();

    // Normalize steps into the exact shape your cron/enroll logic expects.
    const normalizedSteps = steps.map((step, index) => {
      const trimmedText = String(step.text || "").trim();
      if (!trimmedText) {
        throw new Error(`Step ${index + 1} is missing text`);
      }

      let day = step.day;
      if (!day || typeof day !== "string" || !day.trim()) {
        // First step defaults to "immediately", later ones "Day N"
        day = index === 0 ? "immediately" : `Day ${index}`;
      }

      return {
        text: trimmedText,
        day: String(day),
        time: step.time && typeof step.time === "string" ? step.time : "9:00 AM",
        calendarLink: "",
      };
    });

    const doc = await DripCampaign.create({
      name: String(name).trim(),
      key: undefined, // optional; can be set later if you want a slug
      type: "sms",
      isActive: true,
      assignedFolders: [],
      steps: normalizedSteps,
      analytics: {},
      createdBy: email,
      comments: [],
      user: email,
      userEmail: email,
      isGlobal: false,
    });

    return res.status(201).json({
      campaign: {
        _id: String(doc._id),
        name: doc.name,
        key: doc.key,
        isActive: doc.isActive,
        steps: normalizedSteps,
        isGlobal: false,
        createdBy: email,
        user: email,
        userEmail: email,
      },
    });
  } catch (err: any) {
    console.error("[drips/campaigns POST] error", err);
    return res
      .status(500)
      .json({ error: "Server error", detail: err?.message || "Unknown error" });
  }
}
