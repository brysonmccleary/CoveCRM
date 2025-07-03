import type { NextApiRequest, NextApiResponse } from "next";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ message: "Missing lead ID" });
    }

    const client = await clientPromise;
    const db = client.db("covecrm"); // <-- change to your actual DB name
    const leadsCollection = db.collection("leads");

    const lead = await leadsCollection.findOne({ _id: new ObjectId(id as string) });

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    res.status(200).json({ lead });
  } catch (error) {
    console.error("Get lead error:", error);
    res.status(500).json({ message: "Server error" });
  }
}

