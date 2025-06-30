export const STANDARD_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zipCode",
  "leadSource",
];

export function matchColumnToField(column: string): string {
  const lower = column.toLowerCase();
  if (lower.includes("first")) return "firstName";
  if (lower.includes("last")) return "lastName";
  if (lower.includes("email")) return "email";
  if (lower.includes("phone")) return "phone";
  if (lower.includes("address")) return "address";
  if (lower.includes("city")) return "city";
  if (lower.includes("state")) return "state";
  if (lower.includes("zip")) return "zipCode";
  if (lower.includes("source")) return "leadSource";
  return "";
}

export function saveMappingToLocal(mapping: Record<string, string>) {
  localStorage.setItem("csvFieldMapping", JSON.stringify(mapping));
}

export function getSavedMappings(): Record<string, string> | null {
  const saved = localStorage.getItem("csvFieldMapping");
  return saved ? JSON.parse(saved) : null;
}

