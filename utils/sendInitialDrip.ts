import type { LeadType } from "@/models/Lead";
import { sendSms } from "@/lib/twilio/sendSMS"; // use object-form sender
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";
import crypto from "crypto";

// 👇 Defaults
const DEFAULT_AGENT_NAME = "your licensed agent";
const DEFAULT_AGENT_PHONE = "N/A";
const DEFAULT_FOLDER_NAME = "your campaign";

function getCurrentDate() {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function getCurrentTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Sends the initial drip message for a single lead.
 * Uses {{ contact.first_name }}, {{ contact.last_name }}, {{ contact.full_name }},
 * {{ agent.name }}, {{ agent.first_name }}, {{ agent.last_name }} and ensures opt-out.
 * Preserves legacy <client_first_name> style tokens for backward compatibility.
 * Idempotent per lead+message so it can’t fire 2–4x on overlap.
 */
export async function sendInitialDrip(lead: LeadType, rawMessage?: string) {
  try {
    const to = (lead as any)?.phone || (lead as any)?.Phone;
    if (!to) return;

    const userEmail =
      (lead as any)?.userEmail ||
      (lead as any)?.ownerEmail ||
      (lead as any)?.agentEmail;
    if (!userEmail) return;

    // Contact names
    const firstName =
      (lead as any)?.firstName ||
      (lead as any)?.["First Name"] ||
      (lead as any)?.name?.split?.(" ")?.[0] ||
      null;

    const lastName =
      (lead as any)?.lastName ||
      (lead as any)?.["Last Name"] ||
      ((lead as any)?.name?.split?.(" ") || []).slice(1).join(" ") ||
      null;

    const fullName =
      (lead as any)?.fullName ||
      (lead as any)?.name ||
      [firstName, lastName].filter(Boolean).join(" ") ||
      null;

    // Agent pieces
    const agentNameRaw =
      (lead as any)?.agentName ||
      (lead as any)?.ownerName ||
      (lead as any)?.userName ||
      DEFAULT_AGENT_NAME;

    const { first: agentFirst, last: agentLast } = splitName(agentNameRaw);

    const agentPhone =
      (lead as any)?.agentPhone ||
      (lead as any)?.ownerPhone ||
      (lead as any)?.userPhone ||
      DEFAULT_AGENT_PHONE;

    const folderName =
      (lead as any)?.folderName ||
      (lead as any)?.folder?.name ||
      DEFAULT_FOLDER_NAME;

    // Default message
    const defaultMessage = `Hey {{ contact.first_name | default:"there" }}, we got your request for info — when’s a good time to give you a call?`;

    // 1) Render {{ }} placeholders
    const rendered = renderTemplate(rawMessage || defaultMessage, {
      contact: {
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
      },
      agent: {
        name: agentNameRaw,
        first_name: agentFirst,
        last_name: agentLast,
      },
    });

    // 2) Legacy <token> placeholders
    let message = rendered
      .replace(/<client_first_name>/gi, firstName || "")
      .replace(/<client_last_name>/gi, lastName || "")
      .replace(/<client_full_name>/gi, fullName || (firstName || ""))
      .replace(/<agent_name>/gi, agentNameRaw)
      .replace(/<agent_first_name>/gi, agentFirst || agentNameRaw)
      .replace(/<agent_phone>/gi, agentPhone || "")
      .replace(/<folder_name>/gi, folderName || "")
      .replace(/<current_date>/gi, getCurrentDate())
      .replace(/<current_time>/gi, getCurrentTime());

    // 3) Ensure opt-out
    message = ensureOptOut(message);

    // 4) Idempotency: lock to (lead × message content)
    const idem = crypto
      .createHash("sha1")
      .update(`drip-initial:${String((lead as any)?._id)}:${message}`)
      .digest("hex");

    // 5) Send via unified sender
    await sendSms({
      to,
      body: message,
      userEmail,
      leadId: String((lead as any)?._id || ""),
      idempotencyKey: idem,
    });
  } catch (error) {
    console.error("Failed to send initial drip message:", error);
  }
}
