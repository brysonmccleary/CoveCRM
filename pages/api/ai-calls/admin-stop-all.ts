// pages/api/ai-calls/admin-stop-all.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallSession from "@/models/AICallSession";
import User from "@/models/User";

const ADMIN_KEY = String(process.env.AI_DIALER_ADMIN_KEY || "").trim();

function getProvidedKey(req: NextApiRequest) {
  const q = String((req.query.key as string | undefined) || "").trim();
  const h = String(req.headers["x-admin-key"] || "").trim();
  const auth = String(req.headers["authorization"] || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const b = (m?.[1] || "").trim();
  return (b || h || q || "").trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  if (!ADMIN_KEY) {
    return res.status(500).json({ ok: false, message: "AI_DIALER_ADMIN_KEY missing" });
  }

  const provided = getProvidedKey(req);
  if (!provided || provided !== ADMIN_KEY) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  try {
    await mongooseConnect();

    // Stop all active-ish sessions and clear locks/cooldown
    const stopResult = await AICallSession.updateMany(
      { status: { $in: ["queued", "running", "paused"] } },
      {
        $set: {
          status: "stopped",
          completedAt: new Date(),
          errorMessage: "Stopped by admin-stop-all",
          lockedAt: null,
          lockOwner: null,
          lockExpiresAt: null,
          cooldownUntil: null,
        },
      }
    );

    // Optional: disable dialing at user-level in DB (works even if schema doesn't include it yet)
    // Enable by calling: /api/ai-calls/admin-stop-all?key=...&disableUsers=1
    let disabledUsers = 0;
    const disableUsers = String(req.query.disableUsers || "").trim() === "1";
    if (disableUsers) {
      const userResult = await User.updateMany({}, { $set: { aiDialerEnabled: false } });
      disabledUsers = (userResult as any)?.modifiedCount ?? 0;
    }

    console.log("[AI ADMIN STOP ALL] stopped sessions", {
      matched: (stopResult as any)?.matchedCount ?? 0,
      modified: (stopResult as any)?.modifiedCount ?? 0,
      disabledUsers,
    });

    return res.status(200).json({
      ok: true,
      stoppedSessionsMatched: (stopResult as any)?.matchedCount ?? 0,
      stoppedSessionsModified: (stopResult as any)?.modifiedCount ?? 0,
      disabledUsers,
    });
  } catch (err: any) {
    console.error("[AI ADMIN STOP ALL] error", err?.message || err);
    return res.status(500).json({ ok: false, message: "Failed", error: err?.message || String(err) });
  }
}
