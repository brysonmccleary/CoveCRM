import { useEffect } from "react";

export default function InternalSync() {
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        await fetch("/api/google/poll-new-leads", { method: "POST" });
        console.log("✅ Google Sheets sync triggered");
      } catch (err) {
        console.error("❌ Sync error:", err);
      }
    }, 60 * 1000); // every 60 seconds

    return () => clearInterval(interval);
  }, []);

  return null;
}
