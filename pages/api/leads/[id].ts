// /pages/api/leads/[id].ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]"; // ✅ fixed path
import dbConnect from "@/lib/mongodb";
import Lead from "@/models/Lead";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  const userEmail = session.user.email;
  const { id } = req.query;

  try {
    const lead = await Lead.findOne({ _id: id, user: userEmail });

    if (!lead) {
      return res
        .status(404)
        .json({ message: "Lead not found or access denied" });
    }

    if (req.method === "PUT") {
      const { firstName, lastName, phone, status, notes } = req.body;
      lead.firstName = firstName || lead.firstName;
      lead.lastName = lastName || lead.lastName;
      lead.phone = phone || lead.phone;
      lead.status = status || lead.status;
      lead.notes = notes || lead.notes;

      await lead.save();
      res.status(200).json(lead);
    } else if (req.method === "DELETE") {
      await lead.deleteOne();
      res.status(200).json({ message: "Lead deleted" });
    } else {
      res.status(405).json({ message: "Method not allowed" });
    }
  } catch (error) {
    console.error("Lead update/delete error:", error);
    res.status(500).json({ message: "Server error" });
  }
}
