// /lib/leads/openLeadByPhone.ts
import axios from "axios";

function onlyDigits10(raw?: string) {
  const d = String(raw || "").replace(/\D+/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/**
 * Tries to open a Lead by phone. Quiet on failure:
 * - Returns silently if phone invalid (<10 digits) or no match
 * - Only navigates when the API returns { id }
 */
export async function openLeadByPhone(
  phoneLike: string | undefined,
  sessionEmail: string | undefined,
  push: (url: string) => void
): Promise<void> {
  const l10 = onlyDigits10(phoneLike);
  if (!l10) return; // silently bail on bad/short input

  const res = await axios.get(`/api/leads/by-phone/${l10}`, {
    withCredentials: true,
    headers: { "x-user-email": sessionEmail ?? "" },
    validateStatus: () => true, // never throw
  });

  if (res.status === 200 && res.data?.id) {
    push(`/lead/${res.data.id}`);
  }
  // else: do nothing (no toast, no error overlay)
}

/** Optional parser for calendar events */
export function extractPhoneFromEventLike(e: {
  title?: string; description?: string; location?: string; extendedProps?: any;
}): string | undefined {
  // Prefer explicit props if you set them when creating the event
  const xp = e.extendedProps || {};
  const direct =
    xp.leadPhone ||
    xp.phone ||
    e.location ||
    e.description ||
    e.title ||
    "";

  if (!direct) return undefined;

  // Grab first 10+ digit sequence
  const match = String(direct).match(/(\+?1?[\D]*\d[\D]*\d[\D]*\d[\D]*\d[\D]*\d[\D]*\d[\D]*\d[\D]*\d[\D]*\d[\D]*\d+)/);
  return match?.[1];
}
