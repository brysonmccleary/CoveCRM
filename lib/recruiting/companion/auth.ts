import type { NextApiRequest } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { hashCompanionSecret, readBearerToken } from "./security";
import RecruitingCompanion from "@/models/RecruitingCompanion";

export async function authenticateCompanion(req: NextApiRequest) {
  const token = readBearerToken(req.headers.authorization);
  if (!token) return null;
  await mongooseConnect();
  return RecruitingCompanion.findOne({
    tokenHash: hashCompanionSecret(token),
    enabled: true,
  });
}
