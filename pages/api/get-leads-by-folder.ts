import { NextApiRequest, NextApiResponse } from "next";
import { ObjectId } from "mongodb";
import clientPromise from "../../lib/mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { folderId } = req.query;
    if (!folderId) {
      return res.status(400).json({ message: "Missing folderId" });
    }

    const client = await clientPromise;
    const db = client.db("covecrm");

    const leads = await db
      .collection("leads")
      .find({ folderId: new ObjectId(folderId as string) })
      .toArray();

res.status(200).json({ leads });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching leads" });
  }
}

