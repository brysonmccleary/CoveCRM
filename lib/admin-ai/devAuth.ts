import type { NextApiRequest } from "next";

export function isAdminAiDevBypassAllowed(req: NextApiRequest) {
  if (process.env.NODE_ENV === "production") return false;
  const expected = String(process.env.ADMIN_AI_TEST_KEY || "").trim();
  if (!expected) return false;
  const provided = String(req.headers["x-admin-ai-test-key"] || "").trim();
  return Boolean(provided && provided === expected);
}

