import type { Page } from "playwright-core";
import { normalizeProfileUrl } from "@/lib/recruiting/social/policy";
import type { SocialActionType, SocialPlatform } from "@/lib/recruiting/social/types";
import { pageAppearsSignedOut } from "./browserbase";
import { instagramSeedProfileUrl } from "./discovery-sources";

export type DiscoveredCandidate = { profileUrl: string; displayName: string; evidence: string };
export type HostedActionResult = {
  outcome: "succeeded" | "skipped" | "failed";
  failureCode?: string;
  resultSummary: string;
  pageUrl: string;
};

export type HostedActionJob = {
  platform: SocialPlatform;
  actionType: SocialActionType;
  targetSnapshot: { profileUrl: string; displayName: string };
  message: string;
};

export function parseCompactCount(value: string): number | null {
  const match = value.replace(/,/g, "").trim().match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
  if (!match) return null;
  const multiplier = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "b" ? 1_000_000_000 : 1;
  const count = Math.round(Number(match[1]) * multiplier);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

export async function captureOwnedAccountGrowth(page: Page, platform: SocialPlatform, profileUrl: string) {
  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1000);
  const state = await loginState(page, platform);
  if (state.signedOut) return { loggedOut: true, followerCount: null, connectionCount: null };
  const text = await page.locator("main").count() === 1 ? await page.locator("main").innerText().catch(() => "") : state.bodyText;
  const followers = text.match(/([\d,.]+\s*[kmb]?)\s+followers\b/i)?.[1] || "";
  const connections = text.match(/([\d,.]+\s*[kmb]?)\+?\s+connections\b/i)?.[1] || "";
  return {
    loggedOut: false,
    followerCount: platform === "instagram" ? parseCompactCount(followers) : null,
    connectionCount: platform === "linkedin" ? parseCompactCount(connections) : null,
  };
}

export function searchUrl(platform: SocialPlatform, query: string): string {
  return platform === "linkedin"
    ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`
    : `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`;
}

async function loginState(page: Page, platform: SocialPlatform) {
  const state = await page.evaluate(() => ({
    url: location.href,
    bodyText: document.body?.innerText || "",
    hasPasswordInput: Boolean(document.querySelector('input[type="password"]')),
  }));
  return { ...state, signedOut: pageAppearsSignedOut(platform, state.url, state.bodyText, state.hasPasswordInput) };
}

async function discoverInstagramSeedNetwork(
  page: Page,
  seedAccounts: string[],
  sourceCursor: number,
  maxCandidates: number,
): Promise<{ candidates: DiscoveredCandidate[]; loggedOut: boolean; error: string } | null> {
  const seedUrls = seedAccounts.map(instagramSeedProfileUrl).filter((value): value is string => Boolean(value));
  if (!seedUrls.length) return null;
  const direction = sourceCursor % 2 === 0 ? "followers" : "following";
  const seedUrl = seedUrls[Math.floor(sourceCursor / 2) % seedUrls.length];
  const depthCycle = Math.floor(sourceCursor / Math.max(1, seedUrls.length * 2));
  await page.goto(seedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1000);
  const state = await loginState(page, "instagram");
  if (state.signedOut) return { candidates: [], loggedOut: true, error: "Platform account is not signed in." };

  const graphLink = page.locator(`a[href$="/${direction}/"]`).first();
  if (await graphLink.count() !== 1) return { candidates: [], loggedOut: false, error: `The selected seed account does not expose its ${direction} list.` };
  await graphLink.click({ timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
  const scrollRounds = Math.min(12, 2 + depthCycle);
  for (let round = 0; round < scrollRounds; round += 1) {
    await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return;
      const scrollable = Array.from(dialog.querySelectorAll<HTMLElement>("div")).filter((element) => element.scrollHeight > element.clientHeight + 80)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
    });
    await page.waitForTimeout(450);
  }

  const rawProfiles = await page.evaluate(({ seedUrl: lockedSeed, requestedLimit }) => {
    const reserved = new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories"]);
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return [] as Array<{ profileUrl: string; displayName: string }>;
    const seen = new Set<string>();
    const profiles: Array<{ profileUrl: string; displayName: string }> = [];
    for (const link of Array.from(dialog.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      let parsed: URL;
      try { parsed = new URL(link.href); } catch { continue; }
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length !== 1 || reserved.has(segments[0].toLowerCase()) || !/^[a-zA-Z0-9._]{1,30}$/.test(segments[0])) continue;
      const profileUrl = `https://instagram.com/${segments[0]}`;
      if (profileUrl === lockedSeed.replace("www.", "").replace(/\/$/, "") || seen.has(profileUrl)) continue;
      seen.add(profileUrl);
      const displayName = String(link.innerText || link.querySelector("img")?.getAttribute("alt") || segments[0]).trim().split("\n")[0].slice(0, 120);
      profiles.push({ profileUrl, displayName });
      if (profiles.length >= requestedLimit) break;
    }
    return profiles;
  }, { seedUrl, requestedLimit: Math.min(25, Math.max(1, maxCandidates)) });

  const candidates: DiscoveredCandidate[] = [];
  for (const raw of rawProfiles) {
    await page.goto(raw.profileUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(650);
    const profileState = await loginState(page, "instagram");
    if (profileState.signedOut) return { candidates, loggedOut: true, error: "Platform account is not signed in." };
    const evidence = await page.evaluate(() => String((document.querySelector("main") || document.body)?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 800));
    if (evidence.length < 3) continue;
    candidates.push({ profileUrl: raw.profileUrl, displayName: raw.displayName, evidence });
  }
  return { candidates, loggedOut: false, error: candidates.length ? "" : `No usable profiles were visible in the seed account's ${direction} list.` };
}

export async function discoverHostedCandidates(
  page: Page,
  platform: SocialPlatform,
  query: string,
  maxCandidates: number,
  options: { seedAccounts?: string[]; sourceCursor?: number } = {},
): Promise<{ candidates: DiscoveredCandidate[]; loggedOut: boolean; error: string }> {
  if (platform === "instagram" && options.seedAccounts?.length) {
    const seedResult = await discoverInstagramSeedNetwork(page, options.seedAccounts, options.sourceCursor || 0, maxCandidates);
    if (seedResult) return seedResult;
  }
  await page.goto(platform === "instagram" ? "https://www.instagram.com/" : searchUrl(platform, query), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1200);
  let state = await loginState(page, platform);
  if (state.signedOut) return { candidates: [], loggedOut: true, error: "Platform account is not signed in." };
  if (platform === "instagram") {
    let searchInput = page.locator('input[placeholder="Search"], input[aria-label="Search"]');
    let inputCount = await searchInput.count();
    if (inputCount !== 1) {
      const searchEntry = page.locator('a[href="/explore/search/"], [role="button"][aria-label="Search"], a[aria-label="Search"]');
      if (await searchEntry.count() === 1) {
        await searchEntry.click({ timeout: 8_000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        searchInput = page.locator('input[placeholder="Search"], input[aria-label="Search"]');
        inputCount = await searchInput.count();
      }
    }
    if (inputCount !== 1) return { candidates: [], loggedOut: false, error: "Instagram search is temporarily unavailable." };
    await searchInput.fill(query);
    await page.waitForTimeout(1600);
    state = await loginState(page, platform);
    if (state.signedOut) return { candidates: [], loggedOut: true, error: "Platform account is not signed in." };
  } else {
    await page.waitForTimeout(600);
  }
  const candidates = await page.evaluate(({ platform, requestedLimit }) => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const limit = Math.min(25, Math.max(1, requestedLimit));
    const found: DiscoveredCandidate[] = [];
    const seen = new Set<string>();
    const reserved = new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories"]);
    for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(visible)) {
      let parsed: URL;
      try { parsed = new URL(link.href); } catch { continue; }
      const segments = parsed.pathname.split("/").filter(Boolean);
      const linkedIn = platform === "linkedin" && segments.length === 2 && segments[0].toLowerCase() === "in";
      const instagram = platform === "instagram" && segments.length === 1 && /^[a-zA-Z0-9._]{1,30}$/.test(segments[0]) && !reserved.has(segments[0].toLowerCase());
      if (!linkedIn && !instagram) continue;
      const profileUrl = `${parsed.protocol}//${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`.replace(/\/$/, "");
      if (seen.has(profileUrl)) continue;
      const container = link.closest("li, article, [data-view-name], [role='listitem']") || link.parentElement;
      const evidence = String((container as HTMLElement | null)?.innerText || link.innerText || "").trim().replace(/\s+/g, " ").slice(0, 800);
      const imageAlt = link.querySelector("img")?.getAttribute("alt") || "";
      const displayName = String((link.innerText || imageAlt || segments.at(-1) || "").split("\n")[0]).trim().slice(0, 120);
      if (displayName.length < 2 || evidence.length < 3) continue;
      seen.add(profileUrl);
      found.push({ profileUrl, displayName, evidence });
      if (found.length >= limit) break;
    }
    return found;
  }, { platform, requestedLimit: maxCandidates });
  return {
    candidates,
    loggedOut: false,
    error: candidates.length ? "" : "No unambiguous public profile results were visible.",
  };
}

export async function executeHostedAction(page: Page, job: HostedActionJob): Promise<HostedActionResult> {
  const lockedUrl = normalizeProfileUrl(job.platform, job.targetSnapshot.profileUrl);
  await page.goto(lockedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(1200);
  const state = await loginState(page, job.platform);
  if (state.signedOut) return failure("not_logged_in", "The platform account is not signed in.", lockedUrl);

  return page.evaluate(async ({ job, lockedUrl }) => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const normalizedUrl = (value: string) => {
      const parsed = new URL(value);
      parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    };
    const visibleElements = (selector: string, root: ParentNode = document) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
    const exactInteractive = (label: string, root: ParentNode = document) => {
      const matches = visibleElements('button, [role="button"], a', root).filter((element) =>
        String(element.innerText || element.getAttribute("aria-label") || "").trim().toLowerCase() === label.toLowerCase()
        && element.getAttribute("aria-pressed") !== "true"
      );
      return matches.length === 1
        ? { ok: true as const, element: matches[0] }
        : { ok: false as const, code: matches.length ? "control_ambiguous" : "control_missing", summary: `${label} control ${matches.length ? "is ambiguous" : "was not found"}.` };
    };
    const closestInteractive = (element: HTMLElement | null) =>
      element?.closest<HTMLElement>('button, [role="button"], a') || null;
    const uniqueVisible = (selector: string, root: ParentNode = document) => {
      const matches = visibleElements(selector, root);
      return matches.length === 1
        ? { ok: true as const, element: matches[0] }
        : { ok: false as const, code: matches.length ? "control_ambiguous" : "control_missing" };
    };
    const result = (outcome: "succeeded" | "skipped" | "failed", resultSummary: string, failureCode = "") =>
      ({ outcome, resultSummary, pageUrl: lockedUrl, ...(failureCode ? { failureCode } : {}) });
    const relationship = () => {
      const controls = visibleElements('button, [role="button"]').map((element) =>
        String(element.innerText || element.getAttribute("aria-label") || "").trim().toLowerCase()
      );
      const text = String(document.body?.innerText || "").toLowerCase();
      return {
        following: controls.some((value) => value === "following" || value === "connected" || value === "pending" || value === "requested"),
        pending: controls.some((value) => value === "pending" || value === "requested"),
        followsYou: controls.some((value) => value === "follow back") || /\bfollows you\b/.test(text),
      };
    };
    const priorConversation = (platform: SocialPlatform, textbox: HTMLElement) => {
      const root = textbox.closest('[role="dialog"]') || document.querySelector("main") || document;
      const selector = platform === "linkedin" ? '.msg-s-event-listitem, [data-event-urn]' : '[role="row"]';
      return visibleElements(selector, root).some((element) => {
        if (element.contains(textbox) || textbox.contains(element)) return false;
        const text = String(element.innerText || element.textContent || "").trim();
        return text.length > 0 && !/^(message|send|details)$/i.test(text);
      });
    };
    const setText = (element: HTMLElement, value: string) => {
      element.focus();
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
        setter?.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, value);
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      }
    };
    const exactText = (element: HTMLElement, value: string) => {
      const current = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
        ? element.value : element.innerText || element.textContent || "";
      return current.trim() === value.trim();
    };

    if (normalizedUrl(location.href) !== lockedUrl) return result("failed", "Loaded URL does not match the locked profile.", "target_mismatch");
    const displayName = String(job.targetSnapshot.displayName || "").trim().toLowerCase();
    if (!displayName || !String(document.body?.innerText || "").toLowerCase().includes(displayName)) {
      return result("failed", "The locked display name is not visible on the profile.", "target_mismatch");
    }
    const relation = relationship();
    if (job.actionType === "dm") {
      if (relation.followsYou) return result("skipped", "This person already follows the account; DM intentionally skipped.", "follows_you");
      if (job.platform === "linkedin" && relation.pending) return result("failed", "LinkedIn connection request is still pending.", "connection_pending");
      const message = exactInteractive("Message");
      if (!message.ok) return result("failed", message.summary, message.code);
      message.element.click();
      await delay(1200);
      const textbox = uniqueVisible(job.platform === "linkedin" ? '[contenteditable="true"][role="textbox"]' : 'textarea[placeholder*="Message" i], [contenteditable="true"][role="textbox"]');
      if (!textbox.ok) return result("failed", "Message composer was missing or ambiguous.", textbox.code);
      if (priorConversation(job.platform, textbox.element)) return result("skipped", "A previous conversation already exists.", "prior_conversation");
      setText(textbox.element, job.message);
      if (!exactText(textbox.element, job.message)) return result("failed", "Composer did not contain the exact approved message.", "execution_error");
      const send = exactInteractive("Send");
      if (!send.ok) return result("failed", send.summary, send.code);
      send.element.click();
      await delay(900);
      const conversationRoot = textbox.element.closest('[role="dialog"]') || document.querySelector("main") || document;
      const sentMessageVisible = String(conversationRoot.textContent || "").includes(job.message);
      if (!sentMessageVisible) return result("failed", "The platform did not visibly confirm the exact DM.", "execution_error");
      return result("succeeded", `${job.platform === "linkedin" ? "LinkedIn" : "Instagram"} DM submitted.`);
    }
    if (job.actionType === "connect") {
      if (job.platform !== "linkedin") return result("failed", "Instagram connection requests are not supported.", "unsupported_action");
      if (relation.following) return result("skipped", "Already connected to or following this profile.", "already_following");
      let connect = exactInteractive("Connect", document.querySelector("main") || document);
      if (!connect.ok && connect.code === "control_missing") {
        const more = exactInteractive("More", document.querySelector("main") || document);
        if (more.ok) {
          more.element.click();
          await delay(500);
          const menu = document.querySelector('[role="menu"]') || document;
          connect = exactInteractive("Connect", menu);
        }
      }
      if (!connect.ok) return result("failed", connect.summary, connect.code);
      connect.element.click();
      await delay(800);
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        const withoutNote = exactInteractive("Send without a note", dialog);
        const confirm = withoutNote.ok ? withoutNote : exactInteractive("Send", dialog);
        if (!confirm.ok) return result("failed", "LinkedIn connection confirmation was missing or ambiguous.", confirm.code);
        confirm.element.click();
      }
      await delay(900);
      const confirmedRelationship = relationship();
      if (!confirmedRelationship.pending && !confirmedRelationship.following) return result("failed", "LinkedIn did not visibly confirm the connection request.", "execution_error");
      return result("succeeded", "LinkedIn connection request submitted.");
    }
    if (job.actionType === "follow") {
      if (job.platform !== "instagram") return result("failed", "LinkedIn follow actions are not supported.", "unsupported_action");
      if (relation.following) return result("skipped", "Already following or requested this Instagram profile.", "already_following");
      const profileHeader = document.querySelector("header") || document;
      const follow = exactInteractive("Follow", profileHeader);
      if (!follow.ok) return result("failed", "Instagram Follow control was missing or ambiguous.", follow.code);
      follow.element.click();
      await delay(1200);
      if (!relationship().following) return result("failed", "Instagram did not confirm the follow or follow request.", "execution_error");
      return result("succeeded", "Instagram profile followed before DM.");
    }
    if (relation.following) return result("skipped", "Already following this profile; engagement intentionally skipped.", "already_following");
    if (job.actionType === "like_post" && job.platform === "linkedin") {
      const main = document.querySelector("main") || document;
      const unliked = visibleElements('button[aria-label*="Reaction button state: no reaction" i], button[aria-pressed="false"][aria-label^="Like" i]', main);
      const like = unliked[0] || (() => { const exact = exactInteractive("Like", main); return exact.ok ? exact.element : null; })();
      if (!like) return result("skipped", "No unliked LinkedIn post is currently available.", "content_unavailable");
      like.click();
      await delay(700);
      const linkedinLikeConfirmed = like.getAttribute("aria-pressed") === "true"
        || /reaction button state:\s*(?!no reaction)/i.test(like.getAttribute("aria-label") || "");
      if (!linkedinLikeConfirmed) return result("failed", "LinkedIn did not visibly confirm the post like.", "execution_error");
      return result("succeeded", "LinkedIn post liked.");
    }
    if (job.actionType === "like_post" && job.platform === "instagram") {
      const posts = visibleElements('main a[href*="/p/"]').filter((element) => element.querySelector("img"));
      if (!posts.length) return result("skipped", "No Instagram post is currently available.", "content_unavailable");
      posts[0].click();
      await delay(1200);
      const postRoot = document.querySelector('[role="dialog"] article, [role="dialog"], main article') || document;
      const likeIcons = visibleElements('svg[aria-label="Like"]', postRoot);
      const buttons = [...new Set(likeIcons.map((icon) => closestInteractive(icon)).filter((value): value is HTMLElement => Boolean(value)))];
      const button = buttons.length === 1 ? buttons[0] : null;
      if (!button) return result("failed", "Instagram Like control was missing or ambiguous.", buttons.length ? "control_ambiguous" : "control_missing");
      button.click();
      await delay(700);
      if (!visibleElements('svg[aria-label="Unlike"]', postRoot).length) return result("failed", "Instagram did not visibly confirm the post like.", "execution_error");
      return result("succeeded", "Instagram post liked.");
    }
    if (job.actionType === "like_story" && job.platform === "instagram") {
      const header = document.querySelector("header") || document;
      const storyCandidates = visibleElements('canvas, img[alt*="profile picture" i]', header)
        .map((element) => closestInteractive(element))
        .filter((value): value is HTMLElement => Boolean(value));
      const storyButtons = [...new Set(storyCandidates)].filter((element) => {
        const value = String(element.getAttribute("aria-label") || element.innerText || "").toLowerCase();
        return !/follow|message|more/.test(value);
      });
      const storyButton = storyButtons.length === 1 ? storyButtons[0] : null;
      if (!storyButton) return result("skipped", "No Instagram story is currently available.", "content_unavailable");
      storyButton.click();
      await delay(1200);
      const storyRoot = document.querySelector('[role="dialog"]') || document;
      const likeIcons = visibleElements('svg[aria-label="Like"]', storyRoot);
      const likeButtons = [...new Set(likeIcons.map((icon) => closestInteractive(icon)).filter((value): value is HTMLElement => Boolean(value)))];
      const likeButton = likeButtons.length === 1 ? likeButtons[0] : null;
      if (!likeButton) return result("skipped", "This story cannot be liked right now.", "content_unavailable");
      likeButton.click();
      await delay(700);
      if (!visibleElements('svg[aria-label="Unlike"]', storyRoot).length) return result("failed", "Instagram did not visibly confirm the story like.", "execution_error");
      return result("succeeded", "Instagram story liked.");
    }
    return result("failed", "Action is not supported for this platform.", "unsupported_action");
  }, { job, lockedUrl }) as Promise<HostedActionResult>;
}

function failure(failureCode: string, resultSummary: string, pageUrl: string): HostedActionResult {
  return { outcome: "failed", failureCode, resultSummary, pageUrl };
}
