import { Readable } from "stream";

// Convert a Buffer into a readable stream
export function bufferToStream(buffer: Buffer): Readable {
  return Readable.from(buffer);
}
