#!/usr/bin/env python3
import os, sys, datetime, shutil

PATH = "pages/api/twiml/ringback.ts"

def now():
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

def refuse(msg):
    print(f"[REFUSE] {msg}")
    sys.exit(2)

def main():
    if os.path.exists(PATH):
        refuse(f"{PATH} already exists; refusing to overwrite.")

    os.makedirs(os.path.dirname(PATH), exist_ok=True)

    content = """// /pages/api/twiml/ringback.ts
// TwiML: play your ringback mp3 in a loop (used as Conference waitUrl)
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

export const config = { api: { bodyParser: false } };

function baseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://www.covecrm.com").replace(/\\/$/, "");
  return raw || "https://www.covecrm.com";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const vr = new twilio.twiml.VoiceResponse();
  const ringUrl = `${baseUrl()}/ringback.mp3`;
  vr.play({ loop: 0 }, ringUrl); // loop=0 => infinite on Twilio

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(vr.toString());
}
"""
    open(PATH, "w", encoding="utf-8").write(content)
    print(f"[OK] wrote {PATH}")

if __name__ == "__main__":
    main()
