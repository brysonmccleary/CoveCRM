import { NextApiRequest, NextApiResponse } from "next";
import clientPromise from "@/lib/mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { ids } = req.body;

  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ message: "Invalid IDs" });
  }

  try {
    const client = await clientPromise;
    const db = client.db("covecrm");
    const collection = db.collection("leads");

    const objectIds = ids.map((id) => new (require("mongodb").ObjectId)(id));

    const leads = await collection.find({ _id: { $in: objectIds } }).toArray();

    res.status(200).json(leads);
  } catch (error) {
    console.error("Error fetching leads by IDs:", error);
    res.status(500).json({ message: "Server error" });
  }
}

