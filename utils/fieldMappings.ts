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

export const matchColumnToField = (header: string): string | null => {
  const lowerHeader = header.toLowerCase();
  return STANDARD_FIELDS.find((field) => lowerHeader.includes(field.toLowerCase())) || null;
};

