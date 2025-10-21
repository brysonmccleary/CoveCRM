import type { NextApiRequest, NextApiResponse } from "next";

/**
 * This endpoint was removed along with the "Change AI name" setting.
 * We keep a stub so any lingering callers receive a clear 410 Gone without side effects.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res
    .status(410)
    .json({ ok: false, error: "AI assistant name setting has been removed." });
}
