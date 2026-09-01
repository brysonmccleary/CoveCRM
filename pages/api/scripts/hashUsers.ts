import type { NextApiRequest, NextApiResponse } from "next";

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isExistingBcryptHash(value: unknown): value is string {
  return typeof value === "string" && BCRYPT_HASH_PATTERN.test(value);
}

export function isEligibleForExplicitPasswordMigration(
  value: unknown,
  options: { authorized: boolean; execute: boolean },
) {
  return (
    options.authorized &&
    options.execute &&
    typeof value === "string" &&
    value.length > 0 &&
    !isExistingBcryptHash(value)
  );
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(410).json({
    ok: false,
    writesPerformed: 0,
    error:
      "The legacy password-hash migration is disabled. Use an explicitly authorized, offline migration procedure.",
  });
}
