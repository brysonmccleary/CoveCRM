export type DurableTranscriptTurn = {
  role: "ai" | "lead";
  text: string;
  timestamp: string;
  source: "controller" | "realtime";
  itemId?: string;
};

export function appendDurableTranscriptTurn(
  turns: DurableTranscriptTurn[] | undefined,
  args: {
    role: "ai" | "lead";
    text: unknown;
    source: "controller" | "realtime";
    itemId?: string;
    atMs?: number;
  }
): DurableTranscriptTurn[] {
  const output = turns || [];
  const text = String(args.text || "").replace(/\s+/g, " ").trim();
  if (!text) return output;

  const atMs = args.atMs ?? Date.now();
  const itemId = String(args.itemId || "").trim();
  if (itemId) {
    const existingByItem = output.find(
      (turn) => turn.itemId === itemId && turn.role === args.role
    );
    if (existingByItem) {
      existingByItem.text = text;
      existingByItem.source = args.source;
      return output;
    }
  }

  const latest = output[output.length - 1];
  const latestAtMs = latest ? Date.parse(latest.timestamp) : 0;
  const closeInTime = latestAtMs > 0 && Math.abs(atMs - latestAtMs) <= 60_000;
  if (latest && latest.role === args.role && closeInTime) {
    if (args.source === "realtime" && latest.source === "controller") {
      latest.text = text;
      latest.source = "realtime";
      latest.itemId = itemId || latest.itemId;
      latest.timestamp = new Date(atMs).toISOString();
      return output;
    }
    if (latest.text.toLowerCase() === text.toLowerCase() && Math.abs(atMs - latestAtMs) <= 15_000) {
      if (args.source === "realtime") latest.source = "realtime";
      if (itemId) latest.itemId = itemId;
      return output;
    }
  }

  output.push({
    role: args.role,
    text,
    timestamp: new Date(atMs).toISOString(),
    source: args.source,
    ...(itemId ? { itemId } : {}),
  });
  return output;
}

export function finalTranscriptTurns(turns: DurableTranscriptTurn[]) {
  return turns.map((turn) => ({
    role: turn.role,
    text: turn.text,
    timestamp: turn.timestamp,
  }));
}
