import { NextApiRequest, NextApiResponse } from "next";
import clientPromise from "../../lib/mongodb";
import { ObjectId } from "mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const client = await clientPromise;
    const db = client.db("covecrm");

    const { leadId, status } = req.body;

    await db.collection("leads").updateOne(
      { _id: new ObjectId(leadId) },
      { $set: { status } }
    );

    res.status(200).json({ message: "Lead status updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update lead" });
  }
}

