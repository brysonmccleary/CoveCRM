// /models/Lead.ts
// Canonical Lead model re-export. This guarantees the entire app uses ONE schema:
// the detailed schema defined in /lib/mongo/leads.ts (with indexes/defaults).
export { default } from "@/lib/mongo/leads";
export * from "@/lib/mongo/leads";
