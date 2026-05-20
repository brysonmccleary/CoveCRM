export type AttributionConfidence = "insufficient_data" | "early_signal" | "reliable" | "high_confidence";

export function getAttributionConfidence(input: {
  leads: number;
  spend?: number;
  daysRunning?: number;
  bookedAppointments?: number;
  sold?: number;
}): AttributionConfidence {
  const leads = Number(input.leads || 0);
  const spend = Number(input.spend || 0);
  const daysRunning = Number(input.daysRunning || 0);
  const booked = Number(input.bookedAppointments || 0);
  const sold = Number(input.sold || 0);

  if (leads < 5 || daysRunning < 2 || (spend > 0 && spend < 25)) {
    return "insufficient_data";
  }
  if (leads < 15 || daysRunning < 4 || booked < 2) {
    return "early_signal";
  }
  if (leads >= 50 && daysRunning >= 7 && (sold >= 2 || booked >= 8) && (spend === 0 || spend >= 100)) {
    return "high_confidence";
  }
  return "reliable";
}

