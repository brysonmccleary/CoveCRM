import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export interface User {
  _id?: ObjectId;
  email: string;
  password: string; // store hashed password
  name?: string;
  role?: "user" | "admin";
  createdAt?: Date;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const client = await clientPromise;
  const db = client.db("covecrm");
  return db.collection<User>("users").findOne({ email });
}

export async function createUser(user: User): Promise<void> {
  const client = await clientPromise;
  const db = client.db("covecrm");
  await db.collection<User>("users").insertOne({
    ...user,
    createdAt: new Date(),
  });
}

