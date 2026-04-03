import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import LeadMemoryProfile from "@/models/LeadMemoryProfile";
import LeadMemoryFact from "@/models/LeadMemoryFact";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const userEmail =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";

  if (!userEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const leadId = String(req.query.leadId || "").trim();
  if (!leadId) {
    return res.status(400).json({ message: "Missing leadId" });
  }

  try {
    await mongooseConnect();

    const [profile, facts] = await Promise.all([
      LeadMemoryProfile.findOne({ userEmail, leadId }).lean(),
      LeadMemoryFact.find({ userEmail, leadId, status: "active" })
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    if (!profile) {
      return res.status(200).json({ profile: null });
    }

    return res.status(200).json({
      profile: {
        ...profile,
        keyFacts: facts.map((fact) => ({
          key: fact.key,
          value: fact.value,
          confidence: fact.confidence,
        })),
      },
    });
  } catch (err) {
    console.error("memory profile error:", err);
    return res.status(500).json({ message: "Failed to load memory profile" });
  }
}
