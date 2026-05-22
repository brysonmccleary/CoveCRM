import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isAdminAiDevBypassAllowed } from "@/lib/admin-ai/devAuth";
import { simulateA2PResubmission } from "@/lib/a2p/a2pDryRunSimulator";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

async function requireAdmin(req: NextApiRequest, res: NextApiResponse) {
  if (isAdminAiDevBypassAllowed(req)) return { ok: true as const, email: "dev-bypass" };
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const email = String(session?.user?.email || "").toLowerCase();
  if (!email) return { ok: false as const, status: 401 as const, error: "Unauthorized" };
  if (email !== ADMIN_EMAIL) return { ok: false as const, status: 403 as const, error: "Forbidden" };
  return { ok: true as const, email };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const admin = await requireAdmin(req, res);
  if (!admin.ok) return res.status(admin.status).json({ ok: false, error: admin.error });

  const proposalId = String(req.query.id || "").trim();
  if (!proposalId) {
    return res.status(400).json({ ok: false, error: "Missing proposal ID" });
  }

  // Prevent any proxy, CDN, or browser from caching simulation results.
  // The simulationFingerprint encodes current profile state — a cached result
  // from a previous request would silently present stale state to the admin.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  try {
    const simulation = await simulateA2PResubmission({
      proposalId,
      requestedBy: admin.email,
    });
    return res.status(200).json({ ok: true, simulation });
  } catch (err: any) {
    console.error("[dry-run] simulateA2PResubmission failed:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Simulation failed unexpectedly." });
  }
}
