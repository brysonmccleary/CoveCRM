import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "next-auth/react";
import clientPromise from "../../../lib/mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const session = await getSession({ req });
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { name, email, phone } = req.body;
  const db = await clientPromise;
  const result = await db.db().collection("leads").insertOne({
    userEmail: session.user.email,
    name,
    email,
    phone: phone || "",
  });

  res.status(201).json({
    id: result.insertedId.toString(),
    name,
    email,
    phone: phone || "",
  });
}

