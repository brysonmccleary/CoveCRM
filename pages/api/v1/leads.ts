import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { Types } from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import ApiKey from "@/models/ApiKey";
import Folder from "@/models/Folder";
import { consumeRateLimit, sendRateLimited } from "@/lib/rateLimit";
import { ingestVendorLead, VendorLeadError } from "@/lib/leads/ingestVendorLead";

function bearerToken(req: NextApiRequest): string {
  const header = String(req.headers.authorization || "");
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const apiKeyHeader = Array.isArray(req.headers["x-api-key"])
    ? req.headers["x-api-key"][0]
    : req.headers["x-api-key"];
  return bearer || String(apiKeyHeader || "").trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ message: "Invalid or missing API key" });

  await dbConnect();
  const keyHash = crypto.createHash("sha256").update(token).digest("hex");
  const apiKey = await ApiKey.findOne({ keyHash, revokedAt: null });
  if (!apiKey) return res.status(401).json({ message: "Invalid or revoked API key" });

  // Process-local limiter: move this to a durable shared store before multi-instance scale.
  const rate = consumeRateLimit({ key: `vendor-leads:${apiKey._id}`, limit: 120, windowMs: 60_000 });
  if (!rate.allowed) return sendRateLimited(res, rate.resetAt);

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  void ApiKey.updateOne(
    { _id: apiKey._id, $or: [{ lastUsedAt: null }, { lastUsedAt: { $lt: oneHourAgo } }] },
    { $set: { lastUsedAt: new Date() } },
  ).catch(() => {});

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    let destinationFolderId = apiKey.folderId ? String(apiKey.folderId) : "";

    // Legacy keys may predate folder binding. Bind them once, server-side,
    // without allowing the vendor payload to choose a CoveCRM folder.
    if (!destinationFolderId) {
      const destinationName = String(apiKey.folderName || "").trim()
        || `${String(apiKey.name || "API").trim() || "API"} Leads`;
      const existingFolder = await Folder.findOne({
        userEmail: apiKey.userEmail,
        name: destinationName,
      }).select("_id name").lean();
      const proposedFolderId = existingFolder?._id || new Types.ObjectId();
      const claimedBinding = await ApiKey.findOneAndUpdate(
        {
          _id: apiKey._id,
          $or: [{ folderId: null }, { folderId: { $exists: false } }],
        },
        { $set: { folderId: proposedFolderId, folderName: destinationName } },
        { new: true },
      );
      if (claimedBinding?.folderId) {
        destinationFolderId = String(claimedBinding.folderId);
      } else {
        const currentBinding = await ApiKey.findById(apiKey._id).select("folderId").lean();
        destinationFolderId = currentBinding?.folderId ? String(currentBinding.folderId) : "";
      }
      if (!destinationFolderId) throw new Error("Failed to bind destination folder");

      // Creating by the atomically chosen _id makes simultaneous first-lead
      // requests converge on one folder even without a unique name index.
      const folder = await Folder.findOneAndUpdate(
        { _id: destinationFolderId, userEmail: apiKey.userEmail },
        { $setOnInsert: { userEmail: apiKey.userEmail, name: destinationName, assignedDrips: [] } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      if (!folder?._id) throw new Error("Failed to create destination folder");
    }

    const result = await ingestVendorLead({
      userEmail: apiKey.userEmail,
      folderId: destinationFolderId,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      email: body.email,
      state: body.state,
      notes: body.notes,
      age: body.age,
      leadType: body.leadType,
      externalId: body.externalId,
      custom: body.custom,
    });
    return res.status(result.action === "created" ? 201 : 200).json(result);
  } catch (error: any) {
    if (error instanceof VendorLeadError) return res.status(error.status).json({ message: error.message });
    console.error("[vendor-leads] ingestion failed", { error: error?.message || String(error) });
    return res.status(500).json({ message: "Failed to ingest lead" });
  }
}
