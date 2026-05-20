// lib/dispositionToFolder.ts
// Deterministic mapping from a disposition/status label to the canonical system folder name.
// Returns canonical system folder names for known system dispositions,
// returns "Resolved" for that label (not a system folder), otherwise null.
//
// NOTE: Only use this for disposition→folder name decisions. Do not use this in the import path.

export function folderNameForDisposition(status: string): string | null {
  const s = String(status || "").trim().toLowerCase();

  if (s === "sold") return "Sold";
  if (s === "not interested" || s === "notinterested") return "Not Interested";
  if (s === "booked appointment" || s === "booked") return "Booked Appointment";
  if (s === "bad number" || s === "wrong number" || s === "disconnected") return "Bad Number";
  if (s === "no show" || s === "noshow" || s === "no_show") return "No Show";
  if (s === "do not contact" || s === "do_not_contact" || s === "dnc" || s === "opt out" || s === "opt_out" || s === "stop") return "Do Not Contact";
  if (s === "resolved") return "Resolved"; // not a system folder, but we keep pretty case for status/history

  return null; // unknown → no forced folder move
}
