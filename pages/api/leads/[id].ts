// /pages/api/leads/[id].ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = (await getServerSession(
    req,
    res,
    authOptions as any,
  )) as Session | null;

  const userEmail =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";

  if (!userEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  const { id } = req.query as { id?: string };
  if (!id) return res.status(400).json({ message: "Missing id" });

  try {
    // Ensure user scoping uses the correct field name
    const lead = await Lead.findOne({ _id: id, userEmail });
    if (!lead) {
      return res
        .status(404)
        .json({ message: "Lead not found or access denied" });
    }

    if (req.method === "PUT") {
      const { firstName, lastName, phone, status, notes } = (req.body ||
        {}) as {
        firstName?: string;
        lastName?: string;
        phone?: string;
        status?: string;
        notes?: string;
      };

      const anyLead = lead as any;
      // Write into both modern and legacy fields where applicable
      if (firstName) {
        anyLead.firstName = firstName;
        anyLead["First Name"] = firstName;
      }
      if (lastName) {
        anyLead.lastName = lastName;
        anyLead["Last Name"] = lastName;
      }
      if (phone) {
        anyLead.phone = phone;
        anyLead.Phone = phone;
      }
      if (status) anyLead.status = status;
      if (notes) anyLead.notes = notes;

      await lead.save();
      return res.status(200).json({ ok: true, lead });
    }

    if (req.method === "DELETE") {
      await lead.deleteOne();
      return res.status(200).json({ message: "Lead deleted" });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Lead update/delete error:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
