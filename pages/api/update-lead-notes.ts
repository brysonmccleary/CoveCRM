import { NextApiRequest, NextApiResponse } from "next";
import { ObjectId } from "mongodb";
import clientPromise from "../../lib/mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { leadId, notes } = req.body;

    const client = await clientPromise;
    const db = client.db("covecrm");

    await db.collection("leads").updateOne(
      { _id: new ObjectId(leadId) },
      { $set: { Notes: notes } }
    );

    res.status(200).json({ message: "Notes updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating notes" });
  }
}

