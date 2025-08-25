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

const cached: Cached = global.__mongooseCache || { conn: null, promise: null };
if (!global.__mongooseCache) global.__mongooseCache = cached;

export default async function mongooseConnect() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const uri = process.env.MONGODB_URI || process.env.MONGODB_URL || "";
    if (!uri) throw new Error("Missing MONGODB_URI");

    // Keep pool tiny on serverless to avoid connection storms
    const maxPool = parseInt(process.env.MONGODB_MAX_POOL_SIZE || "10", 10);

    const options: any = {
      maxPoolSize: maxPool,
      minPoolSize: 0,
      maxConnecting: 2,              // throttle how many sockets connect at once
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      // family: 4,                  // uncomment if you ever hit IPv6 + DNS weirdness
    };

    cached.promise = mongoose.connect(uri, options).then((m) => m);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
