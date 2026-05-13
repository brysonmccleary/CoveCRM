// pages/api/ai-calls/transfer-fallback.ts
// Called by Twilio if the agent doesn't answer on live transfer.
// Attempts to book the appointment automatically, then says an appropriate message.
import type { NextApiRequest, NextApiResponse } from "next";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const AI_DIALER_AGENT_KEY = process.env.AI_DIALER_AGENT_KEY || "";
const COVECRM_BASE_URL = process.env.COVECRM_BASE_URL || "https://www.covecrm.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { key, sessionId, leadId, callSid, exactTimeText, startTimeUtc, leadTimeZone, agentTimeZone, userEmail, agentName } = req.query as Record<string, string>;

  if (!key || key !== AI_DIALER_CRON_KEY) {
    return res.status(401).send("Unauthorized");
  }

  const agentFirst = (agentName || "our agent").split(" ")[0] || "our agent";

  // Twilio sends DialCallStatus as form-encoded body
  const body = req.body as Record<string, string> | undefined;
  const dialCallStatus = (body?.DialCallStatus || "").toLowerCase();

  res.setHeader("Content-Type", "text/xml");

  try {
    if (dialCallStatus === "completed") {
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" rate="90%">Thank you for your time. Have a great day!</Say>
  <Hangup/>
</Response>`);
    }

    // Agent didn't answer — try to auto-book if we have a startTimeUtc
    let booked = false;

    if (startTimeUtc && startTimeUtc.trim()) {
      try {
        const bookUrl = new URL("/api/ai-calls/book-appointment", COVECRM_BASE_URL);
        bookUrl.searchParams.set("key", AI_DIALER_CRON_KEY);
        const bookRes = await fetch(bookUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ai-dialer-key": AI_DIALER_CRON_KEY,
          },
          body: JSON.stringify({
            aiCallSessionId: sessionId,
            leadId,
            startTimeUtc,
            durationMinutes: 30,
            leadTimeZone,
            agentTimeZone,
            source: "live-transfer-fallback",
          }),
        });
        const bookJson = await bookRes.json();
        if (bookJson.ok === true) {
          booked = true;
          await fetch(new URL("/api/ai-calls/outcome", COVECRM_BASE_URL).toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-agent-key": AI_DIALER_AGENT_KEY,
            },
            body: JSON.stringify({
              callSid,
              outcome: "booked",
              confirmedYes: true,
              repeatBackConfirmed: true,
              summary: "Booked via live transfer fallback — agent did not answer.",
              dispositionRule: "move_to_booked",
            }),
          });
        }
      } catch (err) {
        console.error("[TRANSFER-FALLBACK] Booking error:", err);
      }
    }

    if (booked) {
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" rate="90%">${agentFirst} wasn't available right now, but we've got your appointment scheduled. They'll reach out at the time we discussed. Have a great day!</Say>
  <Hangup/>
</Response>`);
    }

    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" rate="90%">Looks like my agent just stepped into another call. I want to make sure you get taken care of. Someone from our team will follow up with you very shortly. Have a great day.</Say>
  <Hangup/>
</Response>`);
  } catch (err) {
    console.error("[TRANSFER-FALLBACK] Uncaught error:", err);
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" rate="90%">Sorry, we'll have someone reach out to you soon.</Say>
  <Hangup/>
</Response>`);
  }
}
