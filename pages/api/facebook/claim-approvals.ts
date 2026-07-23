import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import MetaClaimRegistry from "@/models/MetaClaimRegistry";
import MetaClaimApproval, { COVECRM_PLATFORM_CLAIM_SCOPE } from "@/models/MetaClaimApproval";
import { validateStates } from "@/lib/facebook/guardrails";

const VALID_PRODUCTS = new Set(["final_expense", "iul", "mortgage_protection", "veteran", "trucker"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  const userEmail = String(session?.user?.email || "").trim().toLowerCase();
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });
  if (!isExperimentalAdminEmail(userEmail)) return res.status(403).json({ error: "Compliance-admin access required" });
  await mongooseConnect();

  if (req.method === "GET") {
    const [claims, approvals] = await Promise.all([
      MetaClaimRegistry.find({}).sort({ claimText: 1 }).lean(),
      MetaClaimApproval.find({ userEmail: COVECRM_PLATFORM_CLAIM_SCOPE }).sort({ claimText: 1 }).lean(),
    ]);
    return res.status(200).json({ claims, approvals });
  }

  const claimText = String(req.body?.claimText || "").trim();
  const claimVersion = String(req.body?.claimVersion || "").trim();
  const carrierBasis = String(req.body?.carrierBasis || "").trim();
  const approvalEvidence = String(req.body?.approvalEvidence || "").trim();
  const eligibleProducts = Array.from(
    new Set<string>((Array.isArray(req.body?.eligibleProducts) ? req.body.eligibleProducts : []).map((value: unknown) => String(value)))
  );
  const expiresAt = new Date(req.body?.expiresAt || "");
  if (req.body?.attestation !== true) return res.status(400).json({ error: "Approval attestation is required" });
  if (!claimText || !claimVersion) return res.status(400).json({ error: "Claim text and version are required" });
  if (carrierBasis.length < 20) return res.status(400).json({ error: "Describe the carrier/product basis for this claim" });
  if (!/^https:\/\//i.test(approvalEvidence)) return res.status(400).json({ error: "Approval evidence must be an HTTPS document URL" });
  if (!eligibleProducts.length || eligibleProducts.some((product) => !VALID_PRODUCTS.has(product))) {
    return res.status(400).json({ error: "Choose valid insurance products for this approval" });
  }
  let states: string[];
  try {
    states = req.body?.states?.includes("*") ? ["*"] : validateStates(req.body?.states);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || "Valid approved states are required" });
  }
  const now = new Date();
  const maxExpiry = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now || expiresAt > maxExpiry) {
    return res.status(400).json({ error: "Approval expiry must be within the next 366 days" });
  }
  const registeredClaim = await MetaClaimRegistry.findOne({ claimText, version: claimVersion }).lean();
  if (!registeredClaim) return res.status(404).json({ error: "Registered claim version not found" });

  const approval = await MetaClaimApproval.findOneAndUpdate(
    { userEmail: COVECRM_PLATFORM_CLAIM_SCOPE, claimText, claimVersion },
    {
      $set: {
        eligibleProducts,
        states,
        carrierBasis,
        approvalEvidence,
        approvedBy: userEmail,
        approvedAt: now,
        expiresAt,
        revokedAt: null,
      },
    },
    { upsert: true, new: true }
  ).lean();
  return res.status(200).json({ ok: true, approval });
}
