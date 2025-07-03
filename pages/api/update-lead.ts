import type { NextApiRequest, NextApiResponse } from "next";
import clientPromise from "../../lib/mongodb";
import { ObjectId } from "mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { leadId, status, notes, folderId } = req.body;
  const client = await clientPromise;
  const db = client.db("covecrm");
  const collection = db.collection("leads");

  const updateFields: any = {};
  if (status) updateFields.status = status;
  if (notes) updateFields.notes = notes;
  if (folderId) updateFields.folderId = new ObjectId(folderId);

  await collection.updateOne(
    { _id: new ObjectId(leadId) },
    { $set: updateFields }
  );

  res.status(200).json({ message: "Lead updated" });
}

