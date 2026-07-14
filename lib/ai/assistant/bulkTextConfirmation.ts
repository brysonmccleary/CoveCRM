import crypto from "crypto";

type BulkTextConfirmationPayload = {
  userEmail: string;
  message: string;
  leadIds: string[];
  expiresAt: number;
};

function secret() {
  return String(process.env.NEXTAUTH_SECRET || process.env.CRON_SECRET || "");
}

function sign(encoded: string) {
  const key = secret();
  if (!key) throw new Error("Bulk-text confirmation is not configured");
  return crypto.createHmac("sha256", key).update(encoded).digest("base64url");
}

export function createBulkTextConfirmation(input: Omit<BulkTextConfirmationPayload, "expiresAt">) {
  const payload: BulkTextConfirmationPayload = {
    ...input,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyBulkTextConfirmation(token: string, userEmail: string): BulkTextConfirmationPayload | null {
  try {
    const [encoded, signature] = String(token || "").split(".");
    if (!encoded || !signature) return null;
    const expected = sign(encoded);
    const suppliedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as BulkTextConfirmationPayload;
    if (payload.userEmail !== String(userEmail || "").toLowerCase()) return null;
    if (!Array.isArray(payload.leadIds) || !payload.message || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
