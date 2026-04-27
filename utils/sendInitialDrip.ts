// /utils/sendInitialDrip.ts
import type { LeadType } from "@/models/Lead";
import { sendSMS } from "@/lib/twilio/sendSMS"; // ✅ central Twilio sender that logs to Message
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";
import { acquireLock } from "@/lib/locks"; // 🔒 add lock

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
 */
export async function sendInitialDrip(lead: LeadType, rawMessage?: string) {
  try {
    const to = (lead as any)?.phone || (lead as any)?.Phone;
    if (!to) return;

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

    // 4) 🔒 Lock to prevent duplicate initial sends from parallel runners (10 min)
    const userEmail = String((lead as any)?.userEmail || (lead as any)?.ownerEmail || "").toLowerCase();
    const leadId = String((lead as any)?._id || (lead as any)?.id || "");
    const campaignId =
      String(((lead as any)?.dripProgress?.dripId) || folderName || "initial");
    const stepId = "initial";

    const ok = await acquireLock("drip", `${userEmail}:${leadId}:${campaignId}:${stepId}`, 600);
    if (!ok) {
      console.log("Duplicate drip suppressed", { userEmail, leadId, campaignId, stepId });
      return;
    }

    // 5) Send & log via Twilio sendSMS helper (writes to Message collection)
    await sendSMS(to, message, (lead as any)?.userId || (lead as any)?.userEmail || "");
  } catch (error) {
    console.error("Failed to send initial drip message:", error);
  }
}
