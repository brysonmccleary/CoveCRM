// lib/dispositionToFolder.ts
// Deterministic mapping from a disposition/status label to the canonical system folder name.
// Returns system folders ("Sold" | "Not Interested" | "Booked Appointment" | "No Show") for known labels,
// returns "Resolved" for that label (not a system folder), otherwise null.
//
// NOTE: Only use this for disposition→folder name decisions. Do not use this in the import path.

export function folderNameForDisposition(status: string): string | null {
  const s = String(status || "").trim().toLowerCase();

  if (s === "sold") return "Sold";
  if (s === "not interested" || s === "notinterested") return "Not Interested";
  if (s === "booked appointment" || s === "booked") return "Booked Appointment";

  // ⬅️ NEW: treat these as "No Show"
  if (s === "no show" || s === "noshow" || s === "missed appointment" || s === "missed appt") {
    return "No Show";
  }

  if (s === "resolved") return "Resolved"; // not a system folder; kept for history pretty case

  return null; // unknown → no forced folder move
}
