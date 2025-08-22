// pages/api/voice/silence.ts
import type { NextApiRequest, NextApiResponse } from "next";

export const config = { api: { bodyParser: false } };

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="3600"/>
</Response>`;
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml);
}
