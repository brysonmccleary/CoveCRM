// /pages/api/calendar/create-event.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { resolveTimezoneFromRequest } from "@/lib/resolveTimezone";
import { sendAppointmentBookedEmail } from "@/lib/email";
import jwt from "jsonwebtoken";

/** Utility: take last 10 digits for phone matching */
function last10(raw?: string): string | undefined {
  const d = String(raw || "").replace(/\D+/g, "");
  if (!d) return undefined;
  return d.slice(-10) || undefined;
}

function getBaseUrl(req: NextApiRequest) {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    req.headers.host ||
    "localhost:3000";
  return `${proto}://${host}`.replace(/\/$/, "");
}

/** Treat "Call with" (optionally with phone emoji) as empty if no name follows */
function isBareCallWithTitle(s?: string) {
  const t = (s || "").trim();
  // matches: "Call with", "📞 Call with", any capitalization, and optional trailing punctuation/spaces
  return /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Extended_Pictographic})?\s*call with\s*$/iu.test(
    t,
  );
}

// 🔐 Mobile JWT helper (same pattern as other mobile APIs)
const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "dev-mobile-secret";

function getEmailFromAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const email = (payload?.email || payload?.sub || "").toString().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // ✅ Web (NextAuth session) OR mobile (Bearer mobile JWT)
  const session = await getServerSession(req, res, authOptions).catch(
    () => null as any,
  );
  const jwtEmail = getEmailFromAuth(req);
  const userEmail =
    (session?.user?.email as string | undefined)?.toLowerCase() ||
    jwtEmail ||
    "";
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const {
    title,
    start,
    end,
    startISO, // tolerate legacy payloads
    endISO, // tolerate legacy payloads
    description,
    location,
    attendee, // optional lead email
    leadId,
  } = req.body || {};

  const startStr = start || startISO;
  const endStr = end || endISO;
  if (!startStr || !endStr) {
    return res
      .status(400)
      .json({ message: "Missing required event data (start/end)" });
  }

  await dbConnect();

  const user = await User.findOne({ email: userEmail });
  if (!user) return res.status(404).json({ message: "User not found" });

  // Resolve timezone for correct calendar rendering
  const tz = resolveTimezoneFromRequest(req, "UTC");

  // ---- OAuth client (calendar)
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    getBaseUrl(req);

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI_CALENDAR ||
    `${base}/api/connect/google-calendar/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri,
  );

  // Prefer calendar token store; fall back to Sheets store if present
  const tokenStore: any = (user as any).googleTokens || (user as any).googleSheets || null;

  const accessToken = tokenStore?.accessToken || undefined;
  const refreshToken = tokenStore?.refreshToken || undefined;
  const expiryDate =
    tokenStore?.expiryDate ?? tokenStore?.expiry_date ?? undefined;

  if (!refreshToken) {
    return res.status(400).json({
      message:
        "Calendar not connected (no refresh token). Please connect Google Calendar.",
    });
  }

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiryDate,
  });

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // ---- Enrich from Lead (optional)
    let finalTitle = title || "Sales Call";
    let finalDescription = description || "";
    let finalLocation = location || "";
    const attendees: Array<{ email: string }> = [];

    const baseUrl = (
      process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || base
    ).replace(/\/$/, "");

    const privateProps: Record<string, string> = {};

    let leadEmail = attendee || "";
    let leadDoc: any = null;

    if (leadId) {
      leadDoc = await Lead.findById(leadId).lean();
      if (leadDoc) {
        const first = (
          leadDoc["First Name"] ||
          leadDoc.firstName ||
          ""
        ).toString().trim();
        const last = (
          leadDoc["Last Name"] ||
          leadDoc.lastName ||
          ""
        ).toString().trim();
        const full = `${first} ${last}`.trim() || "Lead";
        const phone =
          leadDoc["Phone"] ||
          leadDoc.phone ||
          leadDoc["Phone Number"] ||
          Object.entries(leadDoc).find(([k]) =>
            k.toLowerCase().includes("phone"),
          )?.[1] ||
          "";
        const email =
          leadDoc.Email ||
          leadDoc.email ||
          Object.entries(leadDoc).find(([k]) =>
            k.toLowerCase().includes("email"),
          )?.[1] ||
          "";

        // 🔒 If caller sent a bare "Call with", replace it with a safe computed title
        if (!finalTitle || isBareCallWithTitle(finalTitle)) {
          finalTitle = `📞 Call with ${full}`;
        }

        const noteBlock =
          description && String(description).trim().length > 0
            ? String(description).trim()
            : leadDoc.Notes || leadDoc.notes || "";
        const crmLink = `${baseUrl}/lead/${leadDoc._id}`;

        finalDescription =
          finalDescription && String(finalDescription).trim().length > 0
            ? finalDescription
            : [
                phone ? `Phone: ${phone}` : null,
                email ? `Email: ${email}` : null,
                noteBlock ? `Notes: ${noteBlock}` : null,
                `CRM: ${crmLink}`,
              ]
                .filter(Boolean)
                .join("\n");

        finalLocation = finalLocation || (phone ? `Phone: ${phone}` : "");

        if (email && typeof email === "string") leadEmail = String(email);

        // Stash cross-linking hints (helpful for later lookups/sync)
        privateProps.leadId = String(leadDoc._id);
        if (phone) {
          const l10 = last10(String(phone));
          if (l10) privateProps.leadPhoneLast10 = l10;
          privateProps.leadPhone = String(phone);
        }
        if (email) privateProps.leadEmail = String(email);
        privateProps.crmLink = crmLink;
      }
    }

    // If no leadDoc, still guard against bare "Call with"
    if (!leadDoc && (!finalTitle || isBareCallWithTitle(finalTitle))) {
      finalTitle = "📞 Call with Lead";
    }

    // Attendees: owner + (optional) lead email
    attendees.push({ email: userEmail });
    if (leadEmail && typeof leadEmail === "string")
      attendees.push({ email: String(leadEmail) });

    // RFC3339 timestamps + explicit tz for Calendar UI
    const startIso = new Date(startStr).toISOString();
    const endIso = new Date(endStr).toISOString();

    const requestBody: any = {
      summary: finalTitle,
      description: finalDescription || "",
      location: finalLocation || "",
      start: { dateTime: startIso, timeZone: tz },
      end: { dateTime: endIso, timeZone: tz },
      attendees,
      extendedProperties: { private: privateProps },
      transparency: "opaque",
    };

    const created = await calendar.events.insert({
      calendarId: (user as any).calendarId || "primary",
      requestBody,
      sendUpdates: "all",
    });

    const eventId = created.data.id;
    if (!eventId) {
      throw new Error("Google Calendar did not return an event id");
    }

    // ========= Persist event → lead, add history =========
    if (leadDoc && String(leadDoc.userEmail).toLowerCase() === userEmail) {
      const startDate = new Date(startStr);
      const endDate = new Date(endStr);
      const durationMin = Math.max(
        1,
        Math.round((endDate.getTime() - startDate.getTime()) / 60000),
      );
      const nice = startDate.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: tz,
      });

      const phone = leadDoc.Phone || leadDoc.phone;
      const l10 = last10(phone);

      await Lead.updateOne(
        { _id: leadDoc._id, userEmail },
        {
          $set: {
            calendarEventId: eventId,
            ...(l10 && !leadDoc.phoneLast10 ? { phoneLast10: l10 } : {}),
          },
          $push: {
            history: {
              type: "booking",
              message: `📅 ${finalTitle} • ${nice} (${durationMin}m)`,
              timestamp: startDate,
              userEmail,
              meta: {
                eventId,
                startsAt: startIso,
                endsAt: endIso,
                timeZone: tz,
              },
            },
          },
        },
      );
    }
    // ================================================

    // ✅ Email the agent (best-effort)
    try {
      const startDate = new Date(startStr);
      const tzLabel =
        new Intl.DateTimeFormat(undefined, {
          timeZone: tz,
          timeZoneName: "short",
        })
          .formatToParts(startDate)
          .find((p) => p.type === "timeZoneName")?.value || tz;

      const leadFirst = leadDoc?.["First Name"] || leadDoc?.firstName || "";
      const leadLast = leadDoc?.["Last Name"] || leadDoc?.lastName || "";
      const leadName = `${leadFirst} ${leadLast}`.trim() || "Client";
      const leadPhone = (leadDoc?.Phone || leadDoc?.phone || "").toString();
      const leadState = (leadDoc?.State || leadDoc?.state || "") as string;

      await sendAppointmentBookedEmail({
        to: userEmail,
        agentName: (user as any)?.name || userEmail.split("@")[0],
        leadName,
        phone: leadPhone,
        state: leadState,
        timeISO: new Date(startStr).toISOString(),
        timezone: tzLabel,
        source: "Dialer",
        eventUrl: created.data.htmlLink || undefined,
      });
    } catch (e) {
      console.warn(
        "Agent email (Dialer) failed (non-blocking):",
        (e as any)?.message || e,
      );
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ success: true, eventId, tz });
  } catch (error: any) {
    console.error(
      "❌ Failed to create Google Calendar event:",
      error?.response?.data || error?.message || error,
    );
    return res.status(500).json({ message: "Failed to create event" });
  }
}
