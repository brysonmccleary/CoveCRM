// /lib/format.ts
export function formatStamp(d: string | Date | undefined | null) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const date = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} • ${time}`;
}
