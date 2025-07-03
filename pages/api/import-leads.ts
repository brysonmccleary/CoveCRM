import type { NextApiRequest, NextApiResponse } from "next";
import clientPromise from "@/lib/mongodb";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);

    if (!session) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const userId = session.user.id;

    const leads = req.body.leads;

    if (!leads || !Array.isArray(leads)) {
      return res.status(400).json({ message: "Invalid leads data" });
    }

    // Attach ownerId to each lead
    const updatedLeads = leads.map((lead) => ({
      ...lead,
      ownerId: userId,
    }));

    const client = await clientPromise;
    const db = client.db("covecrm");
    const leadsCollection = db.collection("leads");

    await leadsCollection.insertMany(updatedLeads);

    res.status(200).json({ message: "Leads imported successfully" });
  } catch (error) {
    console.error("Import leads error:", error);
    res.status(500).json({ message: "Server error" });
  }
}

