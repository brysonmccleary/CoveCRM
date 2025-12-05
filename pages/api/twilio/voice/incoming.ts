// /pages/api/twilio/voice/incoming.ts
// Thin alias to /pages/api/twilio/voice/answer.ts
//
// Purpose:
//   - Give Twilio a separate "incoming" Voice URL you can point your TwiML App at.
//   - Reuse all existing bridge logic from voice/answer (PSTN <-> client(identity)).
//   - Later, if you want mobile-specific routing, you can modify THIS file
//     without touching the working /voice/answer endpoint.

import type { NextApiRequest, NextApiResponse } from "next";
import answerHandler from "./answer";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // For now, just delegate to the existing TwiML logic in /voice/answer.
  // This already:
  //   - Bridges browser Twilio Client → PSTN (outbound)
  //   - Bridges PSTN → client(identity) (inbound)
  //
  // Once your mobile app is fully registered with Twilio under the same
  // identity (email-sanitized), both web + mobile will ring on inbound.
  return answerHandler(req, res);
}
