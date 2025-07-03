import { NextApiRequest, NextApiResponse } from "next";
import clientPromise from "../../lib/mongodb";
import { ObjectId } from "mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const client = await clientPromise;
    const db = client.db("covecrm");

    const { leadId } = req.query;

    const conversations = await db
      .collection("conversations")
      .find({ leadId: new ObjectId(leadId as string) })
      .toArray();

    res.status(200).json(conversations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch conversations" });
  }
}

