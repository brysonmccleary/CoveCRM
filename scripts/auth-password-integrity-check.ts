import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function assertNoLegacyPasswordFields(source: string, label: string) {
  assert(!source.includes("passwordHash"), `${label} references passwordHash`);
  assert(!source.includes("hashedPassword"), `${label} references hashedPassword`);
}

async function main() {
  const register = read("pages/api/register.ts");
  const verifyEmail = read("pages/api/auth/verify-email.ts");
  const resetPassword = read("pages/api/auth/reset-password.ts");
  const nextAuth = read("pages/api/auth/[...nextauth].ts");
  const mobileLogin = read("pages/api/mobile/login.ts");
  const userModel = read("models/User.ts");

  assert(userModel.includes("password: { type: String }"), "User model must define canonical password");
  assertNoLegacyPasswordFields(userModel, "User model");

  assert(register.includes("const hashed = await bcrypt.hash(pw, 10);"), "Register must hash submitted password once");
  assert(register.includes("password: hashed"), "Register must persist canonical password field");
  assertNoLegacyPasswordFields(register, "Register");

  assert(resetPassword.includes("const hashed = await bcrypt.hash(String(newPassword), 10);"), "Reset must hash new password once");
  assert(resetPassword.includes("user.password = hashed"), "Reset must write canonical password field");
  assertNoLegacyPasswordFields(resetPassword, "Reset password");

  assert(!/\b(?:password|passwordHash|hashedPassword)\s*=/.test(verifyEmail), "Verify email must not assign password fields");
  assert(!/\$set\s*:\s*{[^}]*\b(?:password|passwordHash|hashedPassword)\b/s.test(verifyEmail), "Verify email must not update password fields");

  assert(nextAuth.includes("return String(user?.password || \"\");"), "NextAuth login must read canonical password only");
  assertNoLegacyPasswordFields(nextAuth, "NextAuth login");
  assert(mobileLogin.includes("return String(user?.password || \"\");"), "Mobile login must read canonical password only");
  assertNoLegacyPasswordFields(mobileLogin, "Mobile login");

  const originalPassword = "CorrectHorseBatteryStaple1!";
  const newPassword = "FreshCorrectHorseBatteryStaple2!";
  const user: {
    password: string;
    emailVerified: boolean;
    emailVerificationCodeHash: string | null;
    emailVerificationExpiresAt: Date | null;
  } = {
    password: await bcrypt.hash(originalPassword, 10),
    emailVerified: false,
    emailVerificationCodeHash: "old-code-hash",
    emailVerificationExpiresAt: new Date(Date.now() + 60_000),
  };

  assert(user.password && user.password !== originalPassword, "Register must store a hash, not plaintext");
  assert(await bcrypt.compare(originalPassword, user.password), "Login compare must succeed after register");

  const passwordBeforeVerify = user.password;
  user.emailVerified = true;
  user.emailVerificationCodeHash = null;
  user.emailVerificationExpiresAt = null;
  assert(user.password === passwordBeforeVerify, "Verify email must not mutate password");
  assert(await bcrypt.compare(originalPassword, user.password), "Login compare must succeed after verification");

  user.password = await bcrypt.hash(newPassword, 10);
  assert(!(await bcrypt.compare(originalPassword, user.password)), "Old password must fail after reset");
  assert(await bcrypt.compare(newPassword, user.password), "New password must succeed after reset");

  console.log("auth-password-integrity-check passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
