export const STANDARD_FIELDS = [
  "First Name",
  "Last Name",
  "Age",
  "Date of Birth",
  "Phone",
  "Email",
  "Street Address",
  "City",
  "State",
  "Zip Code",
  "Notes",
];

export const matchColumnToField = (header: string): string | null => {
  const normalized = header.trim().toLowerCase();
  for (let field of STANDARD_FIELDS) {
    if (normalized.includes(field.toLowerCase())) {
      return field;
    }
  }
  return null;
};

