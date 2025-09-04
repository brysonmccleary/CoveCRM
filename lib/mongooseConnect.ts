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

// Remove legacy keepAlive params that can break new drivers
function stripUnsupportedOptionsFromUri(uri: string): string {
  if (!uri) return uri;
  let out = uri.replace(/([?&])keepalive(=[^&]*)?/gi, "$1")
               .replace(/([?&])keepAlive(=[^&]*)?/g, "$1");
  out = out.replace(/[?&]$/g, "");
  out = out.replace(/\?&/g, "?").replace(/&&/g, "&");
  return out;
}

// Extract the db name from a Mongo URI if present
function extractDbFromUri(uri: string): string | null {
  // Matches "...mongodb.net/<dbName>?..." OR "...mongodb.net/<dbName>"
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?\/]+)(?:[?].*)?$/i);
  return m?.[1] ?? null;
}

// Ensure the URI contains a "/<dbName>" segment; append if missing
function ensureDbInUri(uri: string, dbName: string): string {
  const hasDb = !!extractDbFromUri(uri);
  if (hasDb) return uri;
  const qIndex = uri.indexOf("?");
  if (qIndex === -1) return `${uri.replace(/\/?$/, "")}/${dbName}`;
  const base = uri.slice(0, qIndex).replace(/\/?$/, "");
  const qs = uri.slice(qIndex);
  return `${base}/${dbName}${qs}`;
}

export default async function mongooseConnect(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const rawUri = process.env.MONGODB_URI || process.env.MONGODB_URL || "";
    if (!rawUri) throw new Error("Missing MONGODB_URI");

    const uriNoLegacy = stripUnsupportedOptionsFromUri(rawUri);

    // Choose dbName in this order:
    // 1) Explicit env override
    // 2) Whatever is already in the URI
    // 3) Fallback to "covecrm"
    const dbFromUri = extractDbFromUri(uriNoLegacy);
    const finalDbName = process.env.MONGODB_DBNAME || dbFromUri || "covecrm";

    // Make sure the URI actually contains "/<db>"
    const finalUri = ensureDbInUri(uriNoLegacy, finalDbName);

    // Safer defaults
    mongoose.set("strictQuery", true);

    // Keep pool tiny on serverless to avoid connection storms (overridable via env)
    const maxPool = parseInt(
      process.env.MONGODB_MAX_POOL_SIZE || process.env.MONGO_MAX_POOL_SIZE || "5",
      10
    );

    // IMPORTANT: Do NOT pass deprecated driver options
    const options: any = {
      // Guarantee the db even if URI was missing or env wants to override
      dbName: finalDbName,

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

    // Reset cache on disconnect/error in this runtime
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
      .connect(finalUri, options)
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
