import { NextApiRequest, NextApiResponse } from "next";
import clientPromise from "../../../lib/mongodb";
import bcrypt from "bcryptjs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { email, password } = req.body;
  const db = await clientPromise;
  const existing = await db.db().collection("users").findOne({ email });
  if (existing)
    return res.status(400).json({ error: "User already exists" });

  const hashed = await bcrypt.hash(password, 10);
  await db.db().collection("users").insertOne({ email, password: hashed });
  return res.status(201).json({ message: "User created" });
}

