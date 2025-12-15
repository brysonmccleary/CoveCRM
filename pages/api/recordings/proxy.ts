// pages/api/recordings/proxy.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import { getUserByEmail } from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

// ✅ This endpoint fixes "00:00 / blank recording" playback by proxying Twilio recording media
// through our server (so the browser doesn't have to authenticate to Twilio or fight CORS).
// It does NOT touch AI dialer audio streaming (Twilio <Stream> / voice server) in any way.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const requesterEmail: string | undefined = session?.user?.email
    ? String(session.user.email).toLowerCase()
    : undefined;

  if (!requesterEmail) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { callId } = req.query as { callId?: string };

  if (!callId) {
    res.status(400).json({ message: "Missing callId" });
    return;
  }

  try {
    await dbConnect();

    const requester = await getUserByEmail(requesterEmail);
    const isAdmin = !!requester && (requester as any).role === "admin";

    const call: any = await (Call as any).findById(callId).lean();
    if (!call) {
      res.status(404).json({ message: "Call not found" });
      return;
    }

    const callOwnerEmail = String(call.userEmail || "").toLowerCase();
    if (!isAdmin && callOwnerEmail !== requesterEmail) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const recordingSid = String(call.recordingSid || "").trim();
    const callSid = String(call.callSid || "").trim();

    if (!recordingSid) {
      res.status(404).json({ message: "No recordingSid on this call" });
      return;
    }

    // ✅ Per-tenant: use the call owner's Twilio context (subaccount routing via getClientForUser)
    const { client } = await getClientForUser(callOwnerEmail);

    // Fetch recording to get its media URI (this ensures we’re pointing at the real resource)
    const rec: any = await (client as any).recordings(recordingSid).fetch();

    // Twilio returns something like:
    //   /2010-04-01/Accounts/{AccountSid}/Recordings/{RecordingSid}.json
    const uri: string = String(rec?.uri || "").trim();
    if (!uri) {
      res.status(404).json({ message: "Recording URI missing from Twilio" });
      return;
    }

    // Media URL is the same URI without .json, plus .mp3
    const mediaPath = uri.replace(/\.json$/i, "") + ".mp3";

    // Use Twilio client.request so auth is handled internally (no leaking tokens to browser)
    const resp: any = await (client as any).request({
      method: "GET",
      uri: mediaPath, // Twilio client supports relative API URIs
    });

    const body = resp?.body;

    // body may be Buffer or string depending on twilio helper internals
    const buf: Buffer =
      Buffer.isBuffer(body) ? body : Buffer.from(body || "", "binary");

    if (!buf || buf.length === 0) {
      res.status(502).json({
        message: "Recording media empty from Twilio",
        callSid,
        recordingSid,
      });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(buf.length));

    // Optional: nice filename
    res.setHeader(
      "Content-Disposition",
      `inline; filename="recording-${recordingSid}.mp3"`
    );

    res.status(200).send(buf);
    return;
  } catch (err: any) {
    console.error("GET /api/recordings/proxy error:", err?.message || err);
    res.status(500).json({ message: "Server error" });
    return;
  }
}
