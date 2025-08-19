import mongoose from "mongoose";

type Cached = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

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
    cached.promise = mongoose.connect(uri).then((m) => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
