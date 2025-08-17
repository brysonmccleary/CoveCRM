import { DateTime } from "luxon";

export function isCallAllowed(timezone: string): boolean {
  const now = DateTime.now().setZone(timezone);
  const hour = now.hour;

  return hour >= 8 && hour < 21; // 8am to 9pm local time
}
