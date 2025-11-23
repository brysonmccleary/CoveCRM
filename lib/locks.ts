// lib/locks.ts
import dbConnect from "@/lib/mongooseConnect";
import SendLock from "@/models/SendLock";

/**
 * Acquire a named lock with a soft TTL.
 *
 * - If no lock exists, we create one and return true.
 * - If a lock exists but ttlAt is in the past (expired), we "take it over"
 *   by updating ttlAt and return true.
 * - If a lock exists and is still valid, we return false.
 *
 * This avoids permanent deadlocks where an old lock document never gets
 * cleaned up (e.g. if a previous run crashed before releasing it).
 */
export async function acquireLock(
  scope: string,
  key: string,
  ttlSeconds = 60
): Promise<boolean> {
  await dbConnect();

  const now = new Date();
  const ttlAt = new Date(now.getTime() + ttlSeconds * 1000);

  try {
    // Try to either:
    //  - grab an expired/missing lock, or
    //  - create a new one if none exists.
    //
    // Filter:
    //  - matches docs where ttlAt is in the past OR missing/NULL
    //  - scoped by scope+key
    const doc = await SendLock.findOneAndUpdate(
      {
        scope,
        key,
        $or: [
          { ttlAt: { $lt: now } },
          { ttlAt: null },
          { ttlAt: { $exists: false } },
        ],
      },
      {
        scope,
        key,
        ttlAt,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    // If we got back a doc here, we now "own" the lock for this TTL window.
    if (doc) {
      // console.log(`[lock] acquired ${scope}:${key} until ${ttlAt.toISOString()}`);
      return true;
    }

    // No matching expired/missing lock; someone else holds a valid one.
    // console.log(`[lock] already held ${scope}:${key}`);
    return false;
  } catch (err: any) {
    // If there is a unique index on (scope,key), concurrent upserts can
    // throw a duplicate key error. That just means someone else won.
    if (err && err.code === 11000) {
      // console.log(`[lock] contention, another worker holds ${scope}:${key}`);
      return false;
    }
    // Any other error is real and should bubble up.
    throw err;
  }
}

/**
 * Optional helper: explicitly release a lock before TTL.
 * Not required for cron (TTL handles it), but kept for completeness.
 */
export async function releaseLock(scope: string, key: string): Promise<void> {
  await dbConnect();
  try {
    await SendLock.deleteOne({ scope, key });
    // console.log(`[lock] released ${scope}:${key}`);
  } catch {
    // non-fatal
  }
}
