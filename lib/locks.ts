// lib/locks.ts
import dbConnect from "@/lib/mongooseConnect";
import SendLock from "@/models/SendLock";

/** Returns true if we acquired the lock; false if another worker already holds it. */
export async function acquireLock(
  scope: string,
  key: string,
  ttlSeconds = 60
): Promise<boolean> {
  await dbConnect();
  const ttlAt = new Date(Date.now() + ttlSeconds * 1000);
  try {
    await SendLock.create({ scope, key, ttlAt });
    return true;
  } catch {
    // duplicate key = someone else holds it
    return false;
  }
}
