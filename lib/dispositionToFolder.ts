// Deterministic mapping from a disposition/status label to the canonical system folder name.
// Returns "Sold" | "Not Interested" | "Booked Appointment" | "No Show" for the known system dispositions,
// returns "Resolved" for that label (not a system folder), otherwise null.
//
// NOTE: Only use this for disposition→folder name decisions. Do not use this in the import path.

export function folderNameForDisposition(status: string): string | null {
  const s = String(status || "").trim().toLowerCase();

  if (s === "sold") return "Sold";
  if (s === "not interested" || s === "notinterested") return "Not Interested";
  if (s === "booked appointment" || s === "booked") return "Booked Appointment";
  if (
    s === "no show" ||
    s === "noshow" ||
    s === "missed appointment" ||
    s === "missed"
  ) {
    return "No Show"; // ← NEW
  }
  if (s === "resolved") return "Resolved"; // not a system folder, but we keep pretty case for status/history

  return null; // unknown → no forced folder move
}
