// /pages/api/leads/my.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    // ✅ Auth
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      console.warn("❌ No session found in /api/leads/my");
      return res.status(401).json({ message: "Unauthorized" });
    }
    const email = String(session.user.email).toLowerCase();
    console.log("📨 Session received in /api/leads/my:", email);

    // ✅ DB
    await mongooseConnect();

    // ✅ Filters (optional)
    // ?folderId=<id>         -> only that folder
    // ?appointments=recent   -> only leads with appointmentTime in last 3h and future
    // ?limit=200             -> limit results (default 500)
    const { folderId, appointments, limit } = req.query as {
      folderId?: string;
      appointments?: string;
      limit?: string;
    };

    const ownerFilter = {
      $or: [{ ownerEmail: email }, { userEmail: email }],
    } as const;

    const query: any = { ...ownerFilter };
    if (folderId) query.folderId = folderId;

    if (appointments === "recent") {
      const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000); // last 3 hours
      query.appointmentTime = { $gte: cutoff };
    }

    const cap = Math.min(Number(limit || 500), 2000);

    const leads = await Lead.find(query)
      .sort(
        appointments === "recent" ? { appointmentTime: 1 } : { updatedAt: -1 },
      )
      .limit(cap)
      .lean();

    console.log(`✅ Found ${leads?.length || 0} leads for ${email}`);
    return res.status(200).json(leads || []);
  } catch (err) {
    console.error("❌ Error in /api/leads/my:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}
