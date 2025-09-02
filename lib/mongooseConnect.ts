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

function stripUnsupportedOptionsFromUri(uri: string): string {
  if (!uri) return uri;
  // Remove keepAlive/keepalive from query string to avoid MongoParseError on newer drivers
  // Handles ?keepAlive=... or &keepAlive=...
  let out = uri.replace(/([?&])keepalive(=[^&]*)?/gi, "$1")
               .replace(/([?&])keepAlive(=[^&]*)?/g, "$1");

  // cleanup any trailing ? or & that might remain
  out = out.replace(/[?&]$/g, "");
  // collapse "&&" or "?&"
  out = out.replace(/\?&/g, "?").replace(/&&/g, "&");
  return out;
}

export default async function mongooseConnect(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const rawUri = process.env.MONGODB_URI || process.env.MONGODB_URL || "";
    if (!rawUri) throw new Error("Missing MONGODB_URI");

    const uri = stripUnsupportedOptionsFromUri(rawUri);

    // Safer defaults
    mongoose.set("strictQuery", true);

    // Keep pool tiny on serverless to avoid connection storms (overridable via env)
    const maxPool = parseInt(
      process.env.MONGODB_MAX_POOL_SIZE || process.env.MONGO_MAX_POOL_SIZE || "5",
      10
    );

    // IMPORTANT: Do NOT pass driver options that are no longer supported (keepAlive, keepAliveInitialDelay, etc.)
    const options: any = {
      maxPoolSize: maxPool,
      minPoolSize: 0,
      maxConnecting: 1,               // throttle concurrent new sockets
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      // Don’t buffer commands while disconnected
      bufferCommands: false,
      // Reasonable defaults
      retryWrites: true,
      w: "majority",
      appName: "CoveCRM",
    };

    // Ensure we reset the cache on connection loss in this runtime
    const attachOnce = () => {
      if (!mongoose.connection.listeners("disconnected").length) {
        mongoose.connection.on("disconnected", () => {
          cached.conn = null;
          cached.promise = null;
        });
        mongoose.connection.on("error", () => {
          cached.conn = null;
          cached.promise = null;
        });
      }
    };
    attachOnce();

    cached.promise = mongoose
      .connect(uri, options)
      .then((m) => {
        cached.conn = m;
        return m;
      })
      .catch((err) => {
        cached.promise = null;
        throw err;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn!;
}
