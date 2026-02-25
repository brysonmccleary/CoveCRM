// pages/api/drips/[id].ts
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import type { NextApiRequest, NextApiResponse } from "next";

function normalizeSteps(steps: any[]) {
  if (steps === undefined) return undefined;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("steps must be a non-empty array");
  }
  return steps.map((step, index) => {
    const text = String(step?.text || "").trim();
    if (!text) throw new Error(`Step ${index + 1} is missing text`);

    const day = String(step?.day || (index === 0 ? "immediately" : `Day ${index}`)).trim();
    const time = typeof step?.time === "string" ? step.time : "9:00 AM";

    return {
      text,
      day,
      time,
      calendarLink: typeof step?.calendarLink === "string" ? step.calendarLink : "",
      views: Number.isFinite(step?.views) ? step.views : 0,
      responses: Number.isFinite(step?.responses) ? step.responses : 0,
    };
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  const userEmail = String(session.user.email).toLowerCase();
  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing id" });
  }

  try {
    // GET can read user-owned OR global
    if (req.method === "GET") {
      const drip = await DripCampaign.findOne({
        _id: id,
        $or: [{ user: userEmail }, { userEmail: userEmail }, { isGlobal: true }],
      });

      
      // If this is a global drip, but the user has an override with the same key,
      // return the override so the UI (still referencing the global _id) sees saved edits.
      if (drip?.isGlobal && drip?.key) {
        const override = await DripCampaign.findOne({
          key: drip.key,
          isGlobal: { $ne: true },
          $or: [{ user: userEmail }, { userEmail: userEmail }],
        });
        if (override) return res.status(200).json(override);
      }
if (!drip) {
        return res.status(404).json({ error: "Drip not found or access denied" });
      }

      return res.status(200).json(drip);
    }

    // PUT/DELETE flow:
    // - If target is GLOBAL and method is PUT: CLONE to a user-owned campaign and return it.
    // - If target is user-owned (and not global): update/delete as normal.
    // - Never allow editing/deleting someone else’s campaign; never allow deleting global.

    const existingAny = await DripCampaign.findOne({
      _id: id,
      $or: [{ user: userEmail }, { userEmail: userEmail }, { isGlobal: true }],
    });

    if (!existingAny) {
      return res.status(404).json({ error: "Drip not found or access denied" });
    }

    // PUT: if global, clone-on-edit
    if (req.method === "PUT") {
      const {
        name,
        type,
        steps,
        assignedFolders,
        isActive,
        analytics,
        comments,
      } = req.body || {};

      // If global: create a user-owned copy and return it (prevents cross-user leakage)
            if (existingAny.isGlobal) {
        const normalized = normalizeSteps(steps) ?? existingAny.steps;

        // If user already has an override for this global drip key, update it instead of creating new.
        const existingOverride = existingAny.key
          ? await DripCampaign.findOne({
              key: existingAny.key,
              isGlobal: { $ne: true },
              $or: [{ user: userEmail }, { userEmail: userEmail }],
            })
          : null;

        if (existingOverride) {
          existingOverride.name = name ?? existingOverride.name;
          existingOverride.type = type ?? existingOverride.type;
          existingOverride.steps = normalized;
          existingOverride.assignedFolders = assignedFolders ?? existingOverride.assignedFolders;
          existingOverride.isActive = isActive ?? existingOverride.isActive;
          existingOverride.analytics = analytics ?? existingOverride.analytics;
          existingOverride.comments = comments ?? existingOverride.comments;
          await existingOverride.save();
          return res.status(200).json(existingOverride);
        }

        const cloned = await DripCampaign.create({
          name: (name ?? existingAny.name),
          key: existingAny.key, // stable key so list endpoints can prefer user version
          type: (type ?? existingAny.type),
          isActive: (isActive ?? existingAny.isActive),
          assignedFolders: (assignedFolders ?? []),
          steps: normalized,
          analytics: (analytics ?? {}),
          createdBy: userEmail,
          comments: (comments ?? []),
          user: userEmail,
          userEmail: userEmail,
          isGlobal: false,
        });

        return res.status(200).json({
          ...cloned.toObject(),
          _id: String(cloned._id),
          clonedFromGlobalId: String(existingAny._id),
        });
      }

      // If not global: must be owned by this user
      const owner = String(existingAny.userEmail || existingAny.user || "").toLowerCase();
      if (owner != userEmail) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Only update fields we explicitly allow; never touch ownership fields.
      existingAny.name = name ?? existingAny.name;
      existingAny.type = type ?? existingAny.type;

      const normalized = normalizeSteps(steps);
      if (normalized !== undefined) {
        existingAny.steps = normalized;
      }

      existingAny.assignedFolders = assignedFolders ?? existingAny.assignedFolders;
      existingAny.isActive = isActive ?? existingAny.isActive;
      existingAny.analytics = analytics ?? existingAny.analytics;
      existingAny.comments = comments ?? existingAny.comments;

      await existingAny.save();
      return res.status(200).json(existingAny);
    }

    // DELETE: never allow deleting global, and only allow owner delete
    if (req.method === "DELETE") {
            if (existingAny.isGlobal) {
        // If UI tries to delete a global drip, delete the user's override (if it exists) instead.
        if (existingAny.key) {
          await DripCampaign.deleteOne({
            key: existingAny.key,
            isGlobal: { $ne: true },
            $or: [{ user: userEmail }, { userEmail: userEmail }],
          });
        }
        return res.status(200).json({ message: "User override removed (global preserved)" });
      }

      const owner = String(existingAny.userEmail || existingAny.user || "").toLowerCase();
      if (owner != userEmail) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await existingAny.deleteOne();
      return res.status(200).json({ message: "Drip deleted" });
    }

    res.setHeader("Allow", "GET,PUT,DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Drip update/delete error:", error);
    return res.status(500).json({ error: "Server error" });
  }
}
