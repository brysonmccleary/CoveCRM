import { useEffect } from "react";

const TZ_SYNCED_KEY = "tz_synced";

export function useTimezoneSync(authed: boolean): void {
  useEffect(() => {
    if (!authed) return;
    if (typeof window === "undefined") return;
    try {
      if (sessionStorage.getItem(TZ_SYNCED_KEY)) return;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      sessionStorage.setItem(TZ_SYNCED_KEY, "1");
      fetch("/api/user/update-timezone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz }),
      }).catch(() => {});
    } catch {
      // non-fatal — never block the page
    }
  }, [authed]);
}
