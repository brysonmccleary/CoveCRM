import type { NextApiRequest, NextApiResponse } from "next";
import clientPromise from "@/lib/mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const client = await clientPromise;
    const db = client.db("covecrm");
    const leadsCollection = db.collection("leads");

    const leads = await leadsCollection.find({}).toArray();

    res.status(200).json({ leads });
  } catch (error) {
    console.error("Get leads error:", error);
    res.status(500).json({ message: "Server error" });
  }
}

