import type { NextApiRequest, NextApiResponse } from "next";
import inboundSmsHandler from "./inbound-sms";

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.warn("[twilio/receive-sms] legacy endpoint forwarded to /api/twilio/inbound-sms");
  return inboundSmsHandler(req, res);
}
