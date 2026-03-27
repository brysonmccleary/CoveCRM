// lib/prospecting/encrypt.ts
// AES-256-CBC encryption for SMTP passwords at rest.
// Key is derived via SHA-256 of ENCRYPTION_KEY env var.
import crypto from "crypto";

const ALGO = "aes-256-cbc";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || "";
  if (!raw) {
    throw new Error("ENCRYPTION_KEY env var is not set");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

/** Encrypt plaintext → "ivHex:encryptedHex" */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt "ivHex:encryptedHex" → plaintext */
export function decrypt(encryptedText: string): string {
  const colonIdx = encryptedText.indexOf(":");
  if (colonIdx === -1) throw new Error("Invalid encrypted format");
  const ivHex = encryptedText.slice(0, colonIdx);
  const dataHex = encryptedText.slice(colonIdx + 1);
  const iv = Buffer.from(ivHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}
