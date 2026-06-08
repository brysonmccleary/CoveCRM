// pages/api/twilio/voice/inbound.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer as microBuffer } from "micro";
import twilio from "twilio";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";

import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import InboundCall from "@/models/InboundCall";
import AISettings from "@/models/AISettings";
import AICallSession from "@/models/AICallSession";

// optional models (tolerant)
let PhoneNumberModel: any = null;
let NumberModel: any = null;
try { PhoneNumberModel = require("@/models/PhoneNumber")?.default ?? null; } catch {}
try { NumberModel = require("@/models/Number")?.default ?? null; } catch {}

const { validateRequest } = twilio;

export const config = { api: { bodyParser: false } };

function normalizeE164(raw?: string): string {
  if (!raw) return "";
  const d = raw.replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (raw.startsWith("+")) return raw.trim();
  return `+${d}`;
}
function last10(raw?: string): string {
  if (!raw) return "";
  const d = raw.replace(/\D+/g, "");
  return d.slice(-10);
}
function resolveFullUrl(req: NextApiRequest): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.NEXT_PUBLIC_BASE_URL?.startsWith("https") ? "https" : "http") ||
    "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string);
  const path = req.url || "/api/twilio/voice/inbound";
  return `${proto}://${host}${path}`;
}

function makeInboundConferenceName(ownerEmail: string, callSid: string) {
  const slug = String(ownerEmail || "user").replace(/[^a-z0-9]+/gi, "_").toLowerCase().slice(0, 20);
  const sid = String(callSid || "").replace(/[^a-z0-9]+/gi, "").toLowerCase().slice(0, 10);
  return `inb_${slug}_${sid || Date.now().toString(36)}`;
}

function baseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
  return raw || "https://www.covecrm.com";
}

function aiVoiceStreamUrl(): string {
  const raw = String(process.env.AI_VOICE_STREAM_URL || "").replace(/\/$/, "");
  return raw ? `${raw}/media-stream` : "";
}

function xmlEscape(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildAiInboundTwiml(args: {
  streamUrl: string;
  sessionId: string;
  leadId: string;
  userEmail: string;
}) {
  const param = (name: string, value: string) =>
    `<Parameter name="${xmlEscape(name)}" value="${xmlEscape(value)}" />`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEscape(args.streamUrl)}">
      ${param("sessionId", args.sessionId)}
      ${param("leadId", args.leadId)}
      ${param("userEmail", args.userEmail)}
      ${param("callDirection", "inbound")}
    </Stream>
  </Connect>
</Response>`;
}

function invalidInboundTwiml() {
  const vr = new twilio.twiml.VoiceResponse();
  vr.say("We're sorry, this number is not configured.");
  return vr.toString();
}

function maskPhone(value: string) {
  const d = String(value || "").replace(/\D+/g, "");
  return d ? `***${d.slice(-4)}` : "";
}

function safeScriptKey(value: any) {
  return String(value || "").trim();
}

function pickFirst(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}
function buildLeadFullName(lead: any): string | undefined {
  const f = pickFirst(lead, ["firstName","First Name","FirstName","first_name","name","Name"]);
  const l = pickFirst(lead, ["lastName","Last Name","LastName","last_name","surname"]);
  if (f && l) return `${f} ${l}`.trim();
  if (f) return f;
  if (typeof lead?.email === "string" && lead.email) return lead.email.split("@")[0];
  return undefined;
}

async function mapDidToOwnerEmail(toE164: string): Promise<string | undefined> {
  if (!toE164) return undefined;

  if (PhoneNumberModel) {
    const pn =
      (await PhoneNumberModel.findOne(
        { $or: [{ phoneNumber: toE164 }, { number: toE164 }] },
        null,
        { lean: true }
      )) || null;
    if (pn?.userEmail) return String(pn.userEmail).toLowerCase();
    if (pn?.userId) {
      const owner = await User.findById(pn.userId).lean();
      if (owner?.email) return String(owner.email).toLowerCase();
    }
  }

  if (NumberModel) {
    const n = (await NumberModel.findOne({ phoneNumber: toE164 }, null, { lean: true })) || null;
    if (n?.userEmail) return String(n.userEmail).toLowerCase();
  }

  const owner = await User.findOne({ "numbers.phoneNumber": toE164 }).lean();
  if (owner?.email) return String(owner.email).toLowerCase();

  return undefined;
}

async function findOrCreateLeadForOwner(ownerEmail: string, fromE164: string, fromLast10: string) {
  let lead =
    (await Lead.findOne({ userEmail: ownerEmail, phoneLast10: fromLast10 }, null, { lean: true })) ||
    (await Lead.findOne({ userEmail: ownerEmail, normalizedPhone: fromE164 }, null, { lean: true })) ||
    (await Lead.findOne({ userEmail: ownerEmail, Phone: fromE164 }, null, { lean: true }));
  if (lead) return lead;

  const now = new Date();
  const doc = await (Lead as any).create({
    userEmail: ownerEmail,
    normalizedPhone: fromE164,
    phoneLast10: fromLast10,
    source: "inbound-call",
    status: "New",
    createdAt: now,
    updatedAt: now,
  });
  return JSON.parse(JSON.stringify(doc));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // raw body & params
  const rawBody = await microBuffer(req);
  const bodyStr = rawBody.toString("utf8");
  const params = new URLSearchParams(bodyStr);
  const paramsObj: Record<string, string> = {};
  params.forEach((v, k) => (paramsObj[k] = v));

  const callSid = params.get("CallSid") || "";
  const fromRaw  = params.get("From") || "";
  const toRaw    = params.get("To") || "";
  const from = normalizeE164(fromRaw);
  const to   = normalizeE164(toRaw);
  const fromLast10 = last10(from);

  let ownerEmail: string | undefined;
  let ownerDoc: any | null = null;
  let leadDoc: any | null = null;

  try {
    await dbConnect();
    ownerEmail = await mapDidToOwnerEmail(to);
    if (ownerEmail) {
      ownerDoc = await User.findOne({ email: ownerEmail }).lean();
    }
  } catch (e) {
    console.error("DB mapping error:", e);
  }

  // signature check after owner lookup so subaccount-owned numbers don't fail on platform token.
  try {
    const sig = (req.headers["x-twilio-signature"] as string) || "";
    const url = resolveFullUrl(req);
    const requestAccountSid = String(params.get("AccountSid") || "").trim();
    const ownerAccountSid = String(ownerDoc?.twilio?.accountSid || "").trim();

    if (ownerAccountSid) {
      if (!requestAccountSid || requestAccountSid !== ownerAccountSid) {
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(invalidInboundTwiml());
      }
    } else {
      const token = process.env.TWILIO_AUTH_TOKEN || "";
      if (!token || !validateRequest(token, sig, url, paramsObj)) {
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(invalidInboundTwiml());
      }
    }
  } catch (e) {
    console.error("Signature validation error:", e);
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(invalidInboundTwiml());
  }

  try {
    if (ownerEmail && fromLast10) {
      leadDoc = await findOrCreateLeadForOwner(ownerEmail, from, fromLast10);
    }
  } catch (e) {
    console.error("Lead lookup/upsert error:", e);
  }

  // inbound debug (incoming-only)
  try {
    console.log("[inbound] map", {
      callSid,
      to,
      from,
      ownerEmail: ownerEmail || null,
      leadId: leadDoc?._id?.toString() || null,
    });
  } catch {}

  // save short-lived InboundCall doc
  try {
    if (callSid) {
      const leadNameFull = leadDoc ? buildLeadFullName(leadDoc) : undefined;
      await InboundCall.findOneAndUpdate(
        { callSid },
        {
          callSid,
          from,
          to,
          ownerEmail: ownerEmail || null,
          leadId: leadDoc?._id?.toString() || null,
          leadName: leadNameFull || null,
          state: "ringing",
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  } catch (e) {
    console.error("InboundCall upsert error:", e);
  }

  // emit banner
  try {
    if (ownerEmail) {
      const EMIT_URL =
        process.env.RENDER_EMIT_URL || "https:\/\/covecrm.onrender.com\/emit\/call-incoming";
      const secret = process.env.EMIT_BEARER_SECRET;

      // inbound debug (incoming-only)
      try {
        console.log("[inbound] emit:attempt", {
          ownerEmail,
          hasSecret: !!secret,
          emitUrl: EMIT_URL,
          callSid,
          leadId: leadDoc?._id?.toString() || null,
        });
      } catch {}

      if (!secret) {
        console.error("Missing EMIT_BEARER_SECRET");
      } else {
        const leadNameFull = leadDoc ? buildLeadFullName(leadDoc) : undefined;
        const resp = await fetch(EMIT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + secret,
          },
          body: JSON.stringify({
            email: ownerEmail,
            callSid,
            leadId: leadDoc?._id?.toString(),
            leadName: leadNameFull,
            phone: from,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          console.error(`Render emit failed (${resp.status}): ${text || resp.statusText}`);
        } else {
          try {
            console.log("[inbound] emit:ok", { status: resp.status, ownerEmail });
          } catch {}
        }
      }
    } else {
      try {
        console.warn("[inbound] emit:skip (missing ownerEmail)", { callSid, to, from });
      } catch {}
    }
  } catch (e) {
    console.error("Render emit error:", e);
  }

  // ✅ AI INBOUND MODE (feature-gated):
  // Only intercept the call if the owner explicitly enabled inbound AI and every
  // bootstrap requirement succeeds. Otherwise fall through to existing human routing.
  try {
    if (!ownerEmail || !leadDoc?._id || !callSid) {
      if (ownerEmail) {
        console.log("[inbound-ai] skip", {
          reason: "missing_owner_lead_or_call_sid",
          ownerEmail,
          hasLead: !!leadDoc?._id,
          callSid: !!callSid,
        });
      }
    } else {
      const aiSettings: any = await AISettings.findOne({ userEmail: ownerEmail }).lean();
      if (aiSettings?.aiInboundEnabled) {
        const streamUrl = aiVoiceStreamUrl();
        const leadId = String(leadDoc._id);
        const folderId = leadDoc.folderId ? String(leadDoc.folderId) : "";

        if (!streamUrl) {
          console.warn("[inbound-ai] bootstrap skipped", { reason: "missing_stream_url", ownerEmail, callSid });
        } else {
          const settingsScriptKey = safeScriptKey(aiSettings.aiInboundScriptKey);
          let folder: any = folderId
            ? await (Folder as any)
                .findOne({ _id: folderId, userEmail: ownerEmail })
                .select("_id aiScriptKey")
                .lean()
            : null;

          let folderScriptKey = safeScriptKey(folder?.aiScriptKey);
          if (!folder?._id && settingsScriptKey) {
            folder = await (Folder as any)
              .findOne({ userEmail: ownerEmail, aiScriptKey: settingsScriptKey })
              .select("_id aiScriptKey")
              .lean();
            folderScriptKey = safeScriptKey(folder?.aiScriptKey);
          }

          const validFolderScriptKey =
            folderScriptKey && folderScriptKey !== "default" ? folderScriptKey : "";
          const scriptKey = validFolderScriptKey || settingsScriptKey;
          const voiceKey = safeScriptKey(aiSettings.aiInboundVoiceKey) || "jacob";

          if (!folder?._id || !scriptKey) {
            console.warn("[inbound-ai] bootstrap skipped", {
              reason: !scriptKey ? "missing_script_key" : "folder_not_found",
              ownerEmail,
              callSid,
              leadId,
              folderId,
            });
          } else {
            const now = new Date();
            const aiSession: any = await (AICallSession as any).findOneAndUpdate(
              { sourceCallSid: callSid, callDirection: "inbound" },
              {
                $setOnInsert: {
                  userEmail: ownerEmail,
                  folderId: folder._id,
                  leadIds: [leadDoc._id],
                  fromNumber: to,
                  callDirection: "inbound",
                  sourceCallSid: callSid,
                  scriptKey,
                  voiceKey,
                  total: 1,
                  lastIndex: 0,
                  status: "running",
                  startedAt: now,
                  completedAt: null,
                  errorMessage: null,
                },
              },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            const twiml = buildAiInboundTwiml({
              streamUrl,
              sessionId: String(aiSession._id),
              leadId,
              userEmail: ownerEmail,
            });

            console.log("[inbound-ai] streaming call", {
              ownerEmail,
              callSid,
              leadId,
              sessionId: String(aiSession._id),
              to: maskPhone(to),
              from: maskPhone(from),
            });

            res.setHeader("Content-Type", "text/xml");
            return res.status(200).send(twiml);
          }
        }
      }
    }
  } catch (e: any) {
    console.warn("[inbound-ai] bootstrap failed; falling back to human routing", {
      ownerEmail: ownerEmail || null,
      callSid,
      reason: e?.message || String(e),
    });
  }

  // ✅ MOBILE INBOUND MODE (flagged):
  // If enabled, put caller into a conference with MP3 ringback as waitUrl,
  // and simultaneously ring the agent's mobile app via Twilio Client (VoIP push).
  //
  // NOTE: This is additive and gated by env to avoid changing existing web inbound behavior.
  if (process.env.MOBILE_INBOUND_ENABLED === "1" && ownerEmail) {
    const conferenceName = makeInboundConferenceName(ownerEmail, callSid);

    // Best-effort: place the agent/mobile leg to Twilio Client identity
    try {
      const { client } = await getClientForUser(ownerEmail);
      const agentJoinUrl = `${baseUrl()}/api/voice/agent-join?conferenceName=${encodeURIComponent(conferenceName)}`;

      const fromForAgent = await pickFromNumberForUser(ownerEmail);
      if (!fromForAgent) {
        console.warn("[inbound] mobile inbound: no from-number for agent leg", { ownerEmail, to });
      } else {
        await client.calls.create({
          to: `client:${ownerEmail}`,
          from: fromForAgent,
          url: agentJoinUrl,
        });
      }

      // Best-effort state update
      try {
        if (callSid) {
          await InboundCall.findOneAndUpdate(
            { callSid },
            { $set: { state: "bridging", conferenceName } },
            { upsert: true }
          );
        }
      } catch {}
    } catch (e: any) {
      console.error("[inbound] mobile agent call create failed:", e?.message || e);
    }

    // Caller into conference, with MP3 ringback as waitUrl so NO Twilio default tones leak.
    const vr = new twilio.twiml.VoiceResponse();
    const dial = vr.dial();

    const waitUrl = `${baseUrl()}/api/twiml/ringback`;
    dial.conference(
      {
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        beep: false,
        waitUrl,
        waitMethod: "POST",
      } as any,
      String(conferenceName),
    );

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(vr.toString());
  }

  // keep the call IN-PROGRESS with YOUR ringback until agent clicks Answer.
  const vr = new twilio.twiml.VoiceResponse();
  if (ownerEmail) {
    const actionUrl = `${baseUrl()}/api/twilio/voice-status?userEmail=${encodeURIComponent(
      ownerEmail,
    )}&direction=inbound`;
    const agentPhone = normalizeE164(String(ownerDoc?.agentPhone || ""));
    const hasAgentPhone = Boolean(agentPhone);
    const dial = vr.dial({
      answerOnBridge: true,
      timeout: hasAgentPhone ? 20 : 25,
      action: actionUrl,
      method: "POST",
    });
    dial.client(
      {
        statusCallback: actionUrl,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"] as any,
        ...(hasAgentPhone ? { timeout: 15 } : {}),
      } as any,
      ownerEmail,
    );
    if (hasAgentPhone) {
      dial.number(
        {
          statusCallback: actionUrl,
          statusCallbackMethod: "POST",
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"] as any,
        } as any,
        agentPhone,
      );
    }
  } else {
    const ringUrl = `${baseUrl()}/ringback.mp3`;
    // loop="0" = infinite on Twilio
    vr.play({ loop: 0 }, ringUrl);
  }

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(vr.toString());
}
