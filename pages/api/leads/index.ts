import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "next-auth/react";
import clientPromise from "../../../lib/mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession({ req });
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = await clientPromise;
  const leads = await db
    .db()
    .collection("leads")
    .find({ userEmail: session.user.email })
    .toArray();

  res.status(200).json(
    leads.map(l => ({
      id: l._id.toString(),
      name: l.name,
      email: l.email,
      phone: l.phone || ""
    }))
  );
}

