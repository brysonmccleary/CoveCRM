import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export interface Lead {
  _id?: ObjectId;
  name: string;
  email: string;
  phone?: string;
  status?: string;
  ownerId?: ObjectId;
  folderName?: string;
  createdAt?: Date;
}

export async function createLead(lead: Lead): Promise<void> {
  const client = await clientPromise;
  const db = client.db("covecrm");
  await db.collection<Lead>("leads").insertOne({
    ...lead,
    createdAt: new Date(),
  });
}

export async function getLeadsByOwner(ownerId: ObjectId, folderName?: string): Promise<Lead[]> {
  const client = await clientPromise;
  const db = client.db("covecrm");
  const query: any = { ownerId };

  if (folderName) {
    query.folderName = folderName;
  }

  return db.collection<Lead>("leads").find(query).toArray();
}

