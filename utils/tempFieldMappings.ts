export const STANDARD_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "zip",
  "dob",
  "age",
];

export function matchColumnToField(header: string): string | null {
  const normalized = header.toLowerCase();

  if (normalized.includes("first")) return "firstName";
  if (normalized.includes("last")) return "lastName";
  if (normalized.includes("phone") || normalized.includes("mobile")) return "phone";
  if (normalized.includes("email")) return "email";
  if (normalized.includes("address")) return "address";
  if (normalized.includes("city")) return "city";
  if (normalized.includes("state")) return "state";
  if (normalized.includes("zip") || normalized.includes("postal")) return "zip";
  if (normalized.includes("birth") || normalized.includes("dob")) return "dob";
  if (normalized.includes("age")) return "age";

  return null;
}

