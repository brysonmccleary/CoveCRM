import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import dbConnect from "@/lib/mongooseConnect";
import ApiKey from "@/models/ApiKey";
import { consumeRateLimit, sendRateLimited } from "@/lib/rateLimit";
import { ingestVendorLead, VendorLeadError } from "@/lib/leads/ingestVendorLead";

function bearerToken(req: NextApiRequest): string {
  const header = String(req.headers.authorization || "");
  return header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
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
    const result = await ingestVendorLead({
      userEmail: apiKey.userEmail,
      folderName: apiKey.folderName || body.folderName,
      folderId: body.folderId,
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
