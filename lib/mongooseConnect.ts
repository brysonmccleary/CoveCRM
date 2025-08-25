// /lib/mongooseConnect.ts
import mongoose from "mongoose";

type Cached = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

// Reuse connection across serverless invocations in the same runtime
declare global {
  // eslint-disable-next-line no-var
  var __mongooseCache: Cached | undefined;
}

let cached: Cached = global.__mongooseCache || { conn: null, promise: null };
if (!global.__mongooseCache) global.__mongooseCache = cached;

export default async function mongooseConnect(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const uri = process.env.MONGODB_URI || process.env.MONGODB_URL || "";
    if (!uri) throw new Error("Missing MONGODB_URI");

    // Safer defaults
    mongoose.set("strictQuery", true);

    // Keep pool tiny on serverless to avoid connection storms
    const maxPool = parseInt(
      process.env.MONGODB_MAX_POOL_SIZE || process.env.MONGO_MAX_POOL_SIZE || "10",
      10
    );

    const options: any = {
      // Pooling caps to avoid Atlas free-tier alerts
      maxPoolSize: maxPool,
      minPoolSize: 0,
      maxConnecting: 2, // throttle concurrent new sockets

      // Faster fail to avoid piling up sockets if Atlas hiccups
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 20000,
      heartbeatFrequencyMS: 10000,

      // Don't buffer commands while disconnected
      bufferCommands: false,

      // Reasonable defaults
      retryWrites: true,
      w: "majority",
      family: 4,
      appName: "CoveCRM",
    };

    cached.promise = mongoose
      .connect(uri, options)
      .then((m) => m)
      .catch((err) => {
        // allow a later retry if the first connect fails
        cached.promise = null;
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn!;
}
