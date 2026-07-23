const DEFAULT_META_GRAPH_VERSION = "v21.0";

export function getMetaGraphVersion(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "production" && !String(env.META_GRAPH_VERSION || "").trim()) {
    throw new Error("META_GRAPH_VERSION must be explicitly configured in production");
  }
  const configured = String(env.META_GRAPH_VERSION || DEFAULT_META_GRAPH_VERSION).trim();
  if (!/^v\d+\.\d+$/.test(configured)) {
    throw new Error("META_GRAPH_VERSION must use the format vNN.N");
  }
  return configured;
}

export function metaGraphUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  if (!normalizedPath) throw new Error("Meta Graph path is required");
  return `https://graph.facebook.com/${getMetaGraphVersion(env)}/${normalizedPath}`;
}

export function metaDialogUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  if (!normalizedPath) throw new Error("Meta dialog path is required");
  return `https://www.facebook.com/${getMetaGraphVersion(env)}/${normalizedPath}`;
}
