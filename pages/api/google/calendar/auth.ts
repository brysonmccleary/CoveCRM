import type { NextApiRequest, NextApiResponse } from "next";
import { getGoogleOAuthClient, SCOPES } from "@/lib/googleClient";

// This API route starts the Google OAuth 2.0 flow for Calendar access
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    const client = getGoogleOAuthClient();

    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
    });

    return res.redirect(url);
  } catch (error) {
    console.error("❌ Error generating Google auth URL:", error);
    return res
      .status(500)
      .json({ message: "Google Auth URL generation failed." });
  }
}
