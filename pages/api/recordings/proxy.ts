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

function parseRangeHeader(
  rangeHeader: string | undefined,
  totalSize: number
): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
  if (!m) return null;

  const startStr = m[1];
  const endStr = m[2];

  // bytes=-500 (last 500 bytes)
  if (!startStr && endStr) {
    const suffix = Math.max(0, parseInt(endStr, 10));
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    const start = Math.max(0, totalSize - suffix);
    const end = totalSize - 1;
    return { start, end };
  }

  const start = startStr ? parseInt(startStr, 10) : 0;
  let end = endStr ? parseInt(endStr, 10) : totalSize - 1;

  if (!Number.isFinite(start) || start < 0) return null;
  if (!Number.isFinite(end) || end < 0) return null;

  if (start >= totalSize) return null;
  if (end >= totalSize) end = totalSize - 1;
  if (end < start) return null;

  return { start, end };
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

    // Determine RecordingSid
    const recordingSid: string | null =
      (call.recordingSid && String(call.recordingSid)) ||
      (call.recordingUrl ? extractRecordingSidFromUrl(String(call.recordingUrl)) : null);

    if (!recordingSid) {
      return res.status(404).json({ message: "No recordingSid found for this call" });
    }

    // Use the correct per-tenant Twilio client
    const { client, accountSid } = await getClientForUser(callUserEmail);

    const mp3Url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;

    const rangeHeader = String(req.headers.range || "").trim();
    const wantsRange = !!rangeHeader;

    // IMPORTANT:
    // Do NOT let the browser hit api.twilio.com directly.
    // We fetch server-side, then stream bytes with proper headers (Safari requires Range/206).
    //
    // We prefer using subaccount credentials from the Twilio client instance (tenant-safe).
    const user = (client as any)?.username;
    const pass = (client as any)?.password;
    const hasBasicCreds = !!user && !!pass;

    const upstreamHeaders: Record<string, string> = {};
    if (hasBasicCreds) {
      const basic = Buffer.from(`${String(user)}:${String(pass)}`).toString("base64");
      upstreamHeaders["Authorization"] = `Basic ${basic}`;
    }
    if (wantsRange) {
      upstreamHeaders["Range"] = rangeHeader;
    }

    const startedAt = Date.now();

    let upstreamStatus = 0;
    let upstreamContentRange = "";
    let upstreamContentLength = "";
    let upstreamContentType = "";

    // Use global fetch (Node 20 on Vercel supports it)
    const upstreamResp = await fetch(mp3Url, {
      method: "GET",
      headers: upstreamHeaders,
    });

    upstreamStatus = upstreamResp.status;
    upstreamContentRange = String(upstreamResp.headers.get("content-range") || "");
    upstreamContentLength = String(upstreamResp.headers.get("content-length") || "");
    upstreamContentType = String(upstreamResp.headers.get("content-type") || "");

    const ab = await upstreamResp.arrayBuffer();
    const fullBuf = Buffer.from(ab);

    // If Twilio ignored Range (rare) but Safari asked for it, we will serve 206 ourselves.
    // This is critical for Safari playback.
    const totalSize = fullBuf.length;

    // Debug logs (Vercel)
    console.log("[recordings/proxy] request", {
      requesterEmail,
      callId: callId || undefined,
      callSid: call.callSid || callSidQ || undefined,
      recordingSid,
      tenantAccountSid: accountSid,
      wantsRange,
      rangeHeader: wantsRange ? rangeHeader : undefined,
      upstreamStatus,
      upstreamContentType,
      upstreamContentLength,
      upstreamContentRange,
      totalSize,
      ms: Date.now() - startedAt,
    });

    // If upstream returned non-OK, pass a minimal error (but do NOT leak creds)
    if (!upstreamResp.ok) {
      // Return JSON so it is visible in Network tab quickly.
      return res.status(502).json({
        message: "Failed to fetch recording from Twilio",
        status: upstreamStatus,
        recordingSid,
      });
    }

    // Default headers (required)
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", "audio/mpeg");

    // If upstream already sent partial content, we mirror it (best path).
    // Otherwise, we may still respond with 206 if the client asked Range.
    if (upstreamStatus === 206) {
      // Mirror upstream range headers if present
      if (upstreamContentRange) res.setHeader("Content-Range", upstreamContentRange);
      if (upstreamContentLength) res.setHeader("Content-Length", upstreamContentLength);

      return res.status(206).send(fullBuf);
    }

    // Upstream 200 path
    if (wantsRange) {
      const parsed = parseRangeHeader(rangeHeader, totalSize);

      if (!parsed) {
        // Invalid range request
        res.setHeader("Content-Range", `bytes */${totalSize}`);
        return res.status(416).end();
      }

      const { start, end } = parsed;
      const chunk = fullBuf.subarray(start, end + 1);
      const chunkSize = chunk.length;

      res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
      res.setHeader("Content-Length", String(chunkSize));

      console.log("[recordings/proxy] served range", {
        start,
        end,
        totalSize,
        chunkSize,
      });

      return res.status(206).send(chunk);
    }

    // Normal 200 full-file response
    res.setHeader("Content-Length", String(totalSize));
    return res.status(200).send(fullBuf);
  } catch (err: any) {
    console.error("GET /api/recordings/proxy error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}
