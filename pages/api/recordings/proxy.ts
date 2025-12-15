// pages/api/recordings/proxy.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import { getUserByEmail } from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { Types } from "mongoose";

function asString(v: string | string[] | undefined) {
  if (!v) return "";
  return Array.isArray(v) ? v[0] : String(v);
}

// Pull RecordingSid out of a Twilio RecordingUrl if needed.
// RecordingUrl usually looks like: https://api.twilio.com/2010-04-01/Accounts/AC.../Recordings/RE... (no extension)
function extractRecordingSidFromUrl(url: string): string | null {
  try {
    const m = url.match(/\/Recordings\/(RE[a-zA-Z0-9]+)/);
    return m?.[1] || null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Auth
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const requesterEmail: string | undefined = session?.user?.email
    ? String(session.user.email).toLowerCase()
    : undefined;

  if (!requesterEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const callId = asString(req.query.callId);
  const callSidQ = asString(req.query.callSid);

  if (!callId && !callSidQ) {
    return res.status(400).json({ message: "Missing callId or callSid" });
  }

  try {
    await dbConnect();

    const requester = await getUserByEmail(requesterEmail);
    const isAdmin = !!requester && (requester as any).role === "admin";

    // Find call either by Mongo _id or by callSid
    let call: any = null;

    if (callId && Types.ObjectId.isValid(callId)) {
      call = await (Call as any).findById(callId).lean();
    }
    if (!call && callSidQ) {
      call = await (Call as any).findOne({ callSid: callSidQ }).lean();
    }

    if (!call) {
      return res.status(404).json({ message: "Call not found" });
    }

    // Tenant isolation
    const callUserEmail = String(call.userEmail || "").toLowerCase();
    if (!isAdmin && callUserEmail !== requesterEmail) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Determine RecordingSid + MP3 URL
    const recordingSid: string | null =
      (call.recordingSid && String(call.recordingSid)) ||
      (call.recordingUrl ? extractRecordingSidFromUrl(String(call.recordingUrl)) : null);

    if (!recordingSid) {
      return res.status(404).json({ message: "No recordingSid found for this call" });
    }

    // Use the correct per-tenant Twilio client
    const { client, accountSid } = await getClientForUser(callUserEmail);

    // Fetch MP3 bytes through Twilio API (server-side), then stream to browser.
    // This avoids browser auth/CORS problems and keeps credentials off the client.
    const mp3Url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;

    const resp = await (client as any).request({
      method: "GET",
      uri: mp3Url,
    });

    // Twilio client.request may return a Buffer, string, or object depending on version.
    // Normalize to Buffer.
    let buf: Buffer;
    const body: any = resp?.body;

    if (Buffer.isBuffer(body)) {
      buf = body;
    } else if (typeof body === "string") {
      buf = Buffer.from(body, "binary");
    } else if (body && body instanceof ArrayBuffer) {
      buf = Buffer.from(body);
    } else if (body?.data && Array.isArray(body.data)) {
      // Some libraries return { data: number[] }
      buf = Buffer.from(body.data);
    } else {
      // Last resort: try JSON/stringify (better than crashing)
      buf = Buffer.from(String(body ?? ""), "utf8");
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Accept-Ranges", "bytes");

    // If Twilio returns an HTML error body, this will still send it,
    // but your player will fail — which is fine and debuggable.
    return res.status(200).send(buf);
  } catch (err: any) {
    console.error("GET /api/recordings/proxy error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}
