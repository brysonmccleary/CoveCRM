// Per-account proxy geolocation. Each connected social account is pinned to a
// stable U.S. location so every hosted session for that account appears from a
// consistent residential region — an account that teleports between cities and
// IPs is one of the strongest automation signals a platform looks for.

export type ProxyGeolocation = { country: string; state?: string; city?: string };

const TIMEZONE_GEO: Record<string, ProxyGeolocation> = {
  "America/New_York": { country: "US", state: "NY", city: "New York" },
  "America/Detroit": { country: "US", state: "MI", city: "Detroit" },
  "America/Indiana/Indianapolis": { country: "US", state: "IN", city: "Indianapolis" },
  "America/Chicago": { country: "US", state: "IL", city: "Chicago" },
  "America/Denver": { country: "US", state: "CO", city: "Denver" },
  "America/Phoenix": { country: "US", state: "AZ", city: "Phoenix" },
  "America/Los_Angeles": { country: "US", state: "CA", city: "Los Angeles" },
  "America/Anchorage": { country: "US", state: "AK", city: "Anchorage" },
  "Pacific/Honolulu": { country: "US", state: "HI", city: "Honolulu" },
};

// Derives a stable geolocation from the account's timezone. Unknown timezones
// fail closed to country-level U.S. so a session never runs without proxying.
export function geolocationForTimeZone(timeZone: string): ProxyGeolocation {
  return TIMEZONE_GEO[String(timeZone || "").trim()] || { country: "US" };
}
