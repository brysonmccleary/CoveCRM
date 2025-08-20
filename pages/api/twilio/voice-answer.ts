import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew-Neural">This call is from Cove CRM.</Say>
</Response>`;
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml);
}
