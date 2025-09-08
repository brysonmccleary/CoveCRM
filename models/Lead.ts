// /models/Lead.ts
// Canonical Lead model re-export so the whole app uses ONE schema.
export { default } from "@/lib/mongo/leads";
export * from "@/lib/mongo/leads";

// Back-compat: some files import `type { ILead }` from here.
export type ILead = any;
