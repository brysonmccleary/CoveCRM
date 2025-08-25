import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { Types } from "mongoose";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email =
    typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  await mongooseConnect();

  // ---------- GET (strict: must provide folderId) ----------
  if (req.method === "GET") {
    try {
      const { folderId } = req.query as { folderId?: string };

      // Strict: without a folderId, return nothing so we never "bleed" across folders
      if (!folderId || folderId === "__none__") {
        return res.status(200).json([]);
      }

      if (!Types.ObjectId.isValid(folderId)) {
        return res.status(400).json({ message: "Invalid folderId" });
      }

      const fid = new Types.ObjectId(folderId);

      const leads = await Lead.find({
        // accept historical ownership fields
        $or: [{ userEmail: email }, { ownerEmail: email }, { user: email }],
        folderId: fid,
      })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      return res.status(200).json(leads);
    } catch (error) {
      console.error("Get leads error:", error);
      return res.status(500).json({ message: "Failed to fetch leads" });
    }
  }

  // ---------- POST (creates a lead, optionally in a folder) ----------
  if (req.method === "POST") {
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
        "Coverage Amount": CoverageAmount,
        folderId,
      } = (req.body || {}) as any;

      let folderObjId: Types.ObjectId | undefined;
      if (folderId) {
        if (!Types.ObjectId.isValid(folderId)) {
          return res.status(400).json({ message: "Invalid folderId" });
        }
        folderObjId = new Types.ObjectId(folderId);
      }

      const now = new Date();

      const newLead = await Lead.create({
        State,
        "First Name": FirstName,
        "Last Name": LastName,
        Email,
        Phone,
        Notes,
        Age,
        Beneficiary,
        "Coverage Amount": CoverageAmount,
        userEmail: email,
        ownerEmail: email,
        user: email, // legacy field for older code paths
        folderId: folderObjId,
        createdAt: now,
        updatedAt: now,
      });

      return res.status(201).json(newLead);
    } catch (error) {
      console.error("Create lead error:", error);
      return res.status(500).json({ message: "Failed to create lead" });
    }
  }

  return res.status(405).json({ message: "Method not allowed" });
}
