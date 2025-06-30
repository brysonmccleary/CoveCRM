export const STANDARD_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zip",
  "notes",
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
  if (lower.includes("zip")) return "zip";
  if (lower.includes("note")) return "notes";
  return "";
}

