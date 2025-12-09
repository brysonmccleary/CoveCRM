// pages/api/ai-calls/voices.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";

type VoiceOption = {
  key: string;
  label: string;
  gender?: "male" | "female" | "neutral";
  style?: string;
  default?: boolean;
};

const VOICES: VoiceOption[] = [
  {
    key: "female_confident_us",
    label: "Female – Confident (US)",
    gender: "female",
    style: "jeremy-style confident closer",
    default: true,
  },
  {
    key: "male_calm_us",
    label: "Male – Calm (US)",
    gender: "male",
    style: "steady, relaxed tone",
  },
  {
    key: "female_high_energy",
    label: "Female – High Energy",
    gender: "female",
    style: "high-energy opener",
  },
  {
    key: "male_low_key",
    label: "Male – Low Key",
    gender: "male",
    style: "low-key conversational",
  },
];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  return res.status(200).json({ voices: VOICES });
}
