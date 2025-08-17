import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const userEmail = session.user.email;

  if (req.method === "GET") {
    try {
      const leads = await Lead.find({ user: userEmail }).sort({ createdAt: -1 });
      res.status(200).json(leads);
    } catch (error) {
      console.error("Get leads error:", error);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  } else if (req.method === "POST") {
    try {
      const {
        State,
        "First Name": FirstName,
        "Last Name": LastName,
        Email,
        Phone,
        Notes,
        Age,
        Beneficiary,
        "Coverage Amount": CoverageAmount
      } = req.body;

      const newLead = new Lead({
        State,
        "First Name": FirstName,
        "Last Name": LastName,
        Email,
        Phone,
        Notes,
        Age,
        Beneficiary,
        "Coverage Amount": CoverageAmount,
        user: userEmail,
        createdAt: new Date(),
      });

      await newLead.save();
      res.status(201).json(newLead);
    } catch (error) {
      console.error("Create lead error:", error);
      res.status(500).json({ message: "Failed to create lead" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
}
