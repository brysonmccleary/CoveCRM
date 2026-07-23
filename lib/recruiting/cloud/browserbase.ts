import { chromium, type Browser, type Page } from "playwright-core";
import type { SocialPlatform } from "@/lib/recruiting/social/types";

const API_BASE = "https://api.browserbase.com/v1";
const PLATFORM_URLS: Record<SocialPlatform, { login: string; home: string }> = {
  instagram: {
    login: "https://www.instagram.com/accounts/login/",
    home: "https://www.instagram.com/",
  },
  linkedin: {
    login: "https://www.linkedin.com/login",
    home: "https://www.linkedin.com/feed/",
  },
};

export type BrowserbaseRegion = "us-west-2" | "us-east-1";

type BrowserbaseSession = {
  id: string;
  connectUrl: string;
  contextId?: string;
  expiresAt?: string;
};

function configuration() {
  const apiKey = String(process.env.BROWSERBASE_API_KEY || "").trim();
  const projectId = String(process.env.BROWSERBASE_PROJECT_ID || "").trim();
  if (!apiKey || !projectId) {
    throw new Error("Account connection service is unavailable.");
  }
  return { apiKey, projectId };
}

export function hostedBrowserIsConfigured(): boolean {
  return Boolean(
    String(process.env.BROWSERBASE_API_KEY || "").trim()
    && String(process.env.BROWSERBASE_PROJECT_ID || "").trim(),
  );
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey } = configuration();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": apiKey,
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Hosted browser request failed (${response.status})${body ? `: ${body.slice(0, 240)}` : ""}`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function createHostedContext(): Promise<string> {
  const { projectId } = configuration();
  const context = await request<{ id: string }>("/contexts", {
    method: "POST",
    body: JSON.stringify({ projectId }),
  });
  if (!context.id) throw new Error("Hosted browser did not return a context ID.");
  return context.id;
}

export async function deleteHostedContext(contextId: string): Promise<void> {
  await request(`/contexts/${encodeURIComponent(contextId)}`, { method: "DELETE" });
}

export async function createHostedSession(params: {
  contextId: string;
  region: BrowserbaseRegion;
  keepAlive?: boolean;
  timeoutSeconds?: number;
  metadata?: Record<string, string>;
}): Promise<BrowserbaseSession> {
  const { projectId } = configuration();
  return request<BrowserbaseSession>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      region: params.region,
      keepAlive: Boolean(params.keepAlive),
      timeout: Math.min(21_600, Math.max(60, params.timeoutSeconds || 300)),
      browserSettings: {
        recordSession: false,
        logSession: false,
        context: { id: params.contextId, persist: true },
        viewport: { width: 1440, height: 900 },
      },
      userMetadata: params.metadata || {},
    }),
  });
}

export async function getHostedSession(sessionId: string): Promise<BrowserbaseSession> {
  return request<BrowserbaseSession>(`/sessions/${encodeURIComponent(sessionId)}`);
}

export async function getHostedLiveView(sessionId: string): Promise<string> {
  const debug = await request<{ debuggerFullscreenUrl: string }>(`/sessions/${encodeURIComponent(sessionId)}/debug`);
  const parsed = new URL(debug.debuggerFullscreenUrl);
  if (parsed.protocol !== "https:") throw new Error("Hosted browser returned an invalid live-view URL.");
  return parsed.toString();
}

export async function releaseHostedSession(sessionId: string): Promise<void> {
  const { projectId } = configuration();
  await request(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: JSON.stringify({ status: "REQUEST_RELEASE", projectId }),
  });
}

async function connect(session: BrowserbaseSession): Promise<Browser> {
  if (!session.connectUrl) throw new Error("Hosted browser session has no connection URL.");
  return chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
}

function defaultPage(browser: Browser): Page {
  const context = browser.contexts()[0];
  if (!context) throw new Error("Hosted browser did not provide a default context.");
  return context.pages()[0] || (() => { throw new Error("Hosted browser did not provide a default page."); })();
}

export async function startLoginSession(params: {
  contextId: string;
  platform: SocialPlatform;
  region: BrowserbaseRegion;
  ownerKey: string;
}): Promise<{ sessionId: string; liveViewUrl: string; expiresAt?: string }> {
  const session = await createHostedSession({
    contextId: params.contextId,
    region: params.region,
    keepAlive: true,
    timeoutSeconds: 3600,
    metadata: { purpose: "cove_social_login", platform: params.platform, owner: params.ownerKey },
  });
  let browser: Browser | null = null;
  try {
    browser = await connect(session);
    const page = defaultPage(browser);
    await page.goto(PLATFORM_URLS[params.platform].login, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch (error) {
    await releaseHostedSession(session.id).catch(() => undefined);
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
  const liveViewUrl = await getHostedLiveView(session.id);
  return { sessionId: session.id, liveViewUrl, expiresAt: session.expiresAt };
}

export function pageAppearsSignedOut(platform: SocialPlatform, url: string, bodyText: string, hasPasswordInput: boolean): boolean {
  const normalizedUrl = url.toLowerCase();
  const normalizedBody = bodyText.slice(0, 4000).toLowerCase();
  if (hasPasswordInput) return true;
  if (platform === "linkedin" && ["/login", "/checkpoint/", "/authwall", "/uas/login"].some((path) => normalizedUrl.includes(path))) return true;
  if (platform === "instagram" && ["/accounts/login", "/challenge/", "/checkpoint/", "/accounts/disabled"].some((path) => normalizedUrl.includes(path))) return true;
  if (/\b(log in|sign in)\b/i.test(bodyText.slice(0, 1200))) return true;
  return [
    "confirm it's you",
    "confirm it’s you",
    "verify your identity",
    "security verification",
    "account has been disabled",
    "account is suspended",
    "we've restricted certain activity",
    "we’ve restricted certain activity",
  ].some((phrase) => normalizedBody.includes(phrase));
}

export async function verifyLoginSessionDetails(sessionId: string, platform: SocialPlatform): Promise<{ authenticated: boolean; profileUrl: string }> {
  const session = await getHostedSession(sessionId);
  let browser: Browser | null = null;
  try {
    browser = await connect(session);
    const page = defaultPage(browser);
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
    const state = await page.evaluate(() => ({
      url: location.href,
      bodyText: document.body?.innerText || "",
      hasPasswordInput: Boolean(document.querySelector('input[type="password"]')),
    }));
    const host = new URL(state.url).hostname.toLowerCase().replace(/^www\./, "");
    const expected = platform === "linkedin" ? "linkedin.com" : "instagram.com";
    const authenticated = host === expected && !pageAppearsSignedOut(platform, state.url, state.bodyText, state.hasPasswordInput);
    if (!authenticated) return { authenticated: false, profileUrl: "" };
    const profileUrl = await page.evaluate((selectedPlatform) => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
      const candidates = links.filter((link) => {
        let parsed: URL;
        try { parsed = new URL(link.href); } catch { return false; }
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (selectedPlatform === "linkedin") return parts.length === 2 && parts[0] === "in" && /view profile|me/i.test(`${link.innerText} ${link.getAttribute("aria-label") || ""}`);
        const reserved = new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories"]);
        return parts.length === 1 && !reserved.has(parts[0].toLowerCase()) && Boolean(link.querySelector('img[alt*="profile picture" i]'));
      });
      const preferred = candidates.filter((link) => link.closest("nav") || /profile|me/i.test(`${link.getAttribute("aria-label") || ""} ${link.getAttribute("title") || ""}`));
      const selected = preferred.length === 1 ? preferred[0] : candidates.length === 1 ? candidates[0] : null;
      if (!selected) return "";
      const parsed = new URL(selected.href);
      return `${parsed.protocol}//${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`.replace(/\/$/, "");
    }, platform).catch(() => "");
    return { authenticated: true, profileUrl };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function verifyLoginSession(sessionId: string, platform: SocialPlatform): Promise<boolean> {
  return (await verifyLoginSessionDetails(sessionId, platform)).authenticated;
}

export async function withHostedPage<T>(params: {
  contextId: string;
  platform: SocialPlatform;
  region: BrowserbaseRegion;
  ownerKey: string;
  task: (page: Page) => Promise<T>;
}): Promise<T> {
  const session = await createHostedSession({
    contextId: params.contextId,
    region: params.region,
    timeoutSeconds: 300,
    metadata: { purpose: "cove_social_worker", platform: params.platform, owner: params.ownerKey },
  });
  let browser: Browser | null = null;
  try {
    browser = await connect(session);
    return await params.task(defaultPage(browser));
  } finally {
    await browser?.close().catch(() => undefined);
    await releaseHostedSession(session.id).catch(() => undefined);
  }
}

export function platformHomeUrl(platform: SocialPlatform): string {
  return PLATFORM_URLS[platform].home;
}
