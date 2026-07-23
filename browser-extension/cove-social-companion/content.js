chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "DISCOVER_COVE_CANDIDATES") {
    discoverCandidates(message.platform, message.maxCandidates)
      .then(sendResponse)
      .catch((error) => sendResponse({ candidates: [], error: error.message }));
    return true;
  }
  if (message?.type === "CHECK_COVE_SESSION") {
    sendResponse({ loggedIn: !isSignedOutPage() });
    return false;
  }
  if (message?.type !== "EXECUTE_COVE_JOB") return false;
  execute(message.job, message.lockedUrl)
    .then(sendResponse)
    .catch((error) => sendResponse(failure("execution_error", error.message, message.lockedUrl)));
  return true;
});

async function discoverCandidates(platform, maxCandidates) {
  if (!hostMatches(platform)) return { candidates: [], error: "Search opened on the wrong platform." };
  if (isSignedOutPage()) {
    return { candidates: [], error: "Platform account is not signed in." };
  }
  await delay(1200);
  const limit = Math.min(25, Math.max(1, Number(maxCandidates || 10)));
  const candidates = [];
  const seen = new Set();
  for (const link of visibleElements("a[href]")) {
    let parsed;
    try { parsed = new URL(link.href); } catch { continue; }
    const segments = parsed.pathname.split("/").filter(Boolean);
    const isLinkedInProfile = platform === "linkedin" && segments.length === 2 && segments[0].toLowerCase() === "in";
    const reserved = new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories"]);
    const isInstagramProfile = platform === "instagram" && segments.length === 1 && /^[a-zA-Z0-9._]{1,30}$/.test(segments[0]) && !reserved.has(segments[0].toLowerCase());
    if (!isLinkedInProfile && !isInstagramProfile) continue;
    const profileUrl = `${parsed.protocol}//${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`.replace(/\/$/, "");
    if (seen.has(profileUrl)) continue;
    const container = link.closest("li, article, [data-view-name], [role='listitem']") || link.parentElement;
    const evidence = String(container?.innerText || link.innerText || "").trim().replace(/\s+/g, " ").slice(0, 500);
    const imageAlt = link.querySelector("img")?.getAttribute("alt") || "";
    const displayName = String((link.innerText || imageAlt || segments.at(-1) || "").split("\n")[0]).trim().slice(0, 120);
    if (displayName.length < 2 || evidence.length < 3) continue;
    seen.add(profileUrl);
    candidates.push({ profileUrl, displayName, evidence });
    if (candidates.length >= limit) break;
  }
  return { candidates, error: candidates.length ? "" : "No unambiguous public profile results were visible." };
}

async function execute(job, lockedUrl) {
  const current = normalizeUrl(location.href);
  if (current !== lockedUrl) return failure("target_mismatch", "Loaded URL does not match the locked profile.", lockedUrl);
  if (!hostMatches(job.platform)) return failure("platform_changed", "Loaded host does not match the queued platform.", lockedUrl);
  if (isSignedOutPage()) {
    return failure("not_logged_in", "The platform account is not signed in.", lockedUrl);
  }
  const displayName = String(job.targetSnapshot?.displayName || "").trim().toLocaleLowerCase();
  if (!displayName || !document.body.innerText.toLocaleLowerCase().includes(displayName)) {
    return failure("target_mismatch", "The locked display name is not visible on the profile.", lockedUrl);
  }

  if (job.platform === "linkedin") return executeLinkedIn(job, lockedUrl);
  if (job.platform === "instagram") return executeInstagram(job, lockedUrl);
  return failure("unsupported_action", "Unsupported platform.", lockedUrl);
}

async function executeLinkedIn(job, lockedUrl) {
  const relationship = readRelationshipState();
  if (job.actionType === "connect") {
    if (relationship.following) return skipped("already_following", "Already connected to or following this LinkedIn profile.", lockedUrl);
    const button = exactInteractive("Connect");
    if (!button.ok) return failure(button.code, button.summary, lockedUrl);
    button.element.click();
    await delay(800);
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      const sendWithoutNote = exactInteractive("Send without a note", dialog);
      const confirm = sendWithoutNote.ok ? sendWithoutNote : exactInteractive("Send", dialog);
      if (!confirm.ok) return failure(confirm.code, "LinkedIn connection confirmation was missing or ambiguous.", lockedUrl);
      confirm.element.click();
    }
    return success("LinkedIn connection request submitted.", lockedUrl);
  }
  if (job.actionType === "dm") {
    if (relationship.followsYou) return skipped("follows_you", "This person already follows the account; DM intentionally skipped.", lockedUrl);
    if (relationship.pending) return failure("connection_pending", "LinkedIn connection request is still pending; DM will be retried later.", lockedUrl);
    const button = exactInteractive("Message");
    if (!button.ok) return failure(button.code, button.summary, lockedUrl);
    button.element.click();
    await delay(1200);
    const textbox = uniqueVisible('[contenteditable="true"][role="textbox"]');
    if (!textbox.ok) return failure(textbox.code, "LinkedIn message composer was missing or ambiguous.", lockedUrl);
    if (hasPriorConversation("linkedin", textbox.element)) return skipped("prior_conversation", "A previous LinkedIn conversation already exists.", lockedUrl);
    setEditableText(textbox.element, job.message);
    if (!editableContains(textbox.element, job.message)) return failure("execution_error", "LinkedIn composer did not contain the exact queued message.", lockedUrl);
    const send = exactInteractive("Send");
    if (!send.ok) return failure(send.code, send.summary, lockedUrl);
    send.element.click();
    return success("LinkedIn DM submitted.", lockedUrl);
  }
  if (job.actionType === "like_post") {
    if (relationship.following) return skipped("already_following", "Already following this LinkedIn profile; engagement intentionally skipped.", lockedUrl);
    const like = exactInteractive("Like");
    if (!like.ok) return failure(like.code, "A unique unliked LinkedIn post was not visible on the locked profile.", lockedUrl);
    like.element.click();
    return success("LinkedIn post liked.", lockedUrl);
  }
  return failure("unsupported_action", "LinkedIn story likes are not supported.", lockedUrl);
}

async function executeInstagram(job, lockedUrl) {
  const relationship = readRelationshipState();
  if (job.actionType === "follow") {
    if (relationship.following) return skipped("already_following", "Already following or requested this Instagram profile.", lockedUrl);
    const profileHeader = document.querySelector("header") || document;
    const button = exactInteractive("Follow", profileHeader);
    if (!button.ok) return failure(button.code, "Instagram Follow control was missing or ambiguous.", lockedUrl);
    button.element.click();
    await delay(1200);
    if (!readRelationshipState().following) return failure("execution_error", "Instagram did not confirm the follow or follow request.", lockedUrl);
    return success("Instagram profile followed before DM.", lockedUrl);
  }
  if (job.actionType === "dm") {
    if (relationship.followsYou) return skipped("follows_you", "This person already follows the account; DM intentionally skipped.", lockedUrl);
    const button = exactInteractive("Message");
    if (!button.ok) return failure(button.code, button.summary, lockedUrl);
    button.element.click();
    await delay(1200);
    const textbox = uniqueVisible('textarea[placeholder*="Message" i], [contenteditable="true"][role="textbox"]');
    if (!textbox.ok) return failure(textbox.code, "Instagram message composer was missing or ambiguous.", lockedUrl);
    if (hasPriorConversation("instagram", textbox.element)) return skipped("prior_conversation", "A previous Instagram conversation already exists.", lockedUrl);
    setEditableText(textbox.element, job.message);
    if (!editableContains(textbox.element, job.message)) return failure("execution_error", "Instagram composer did not contain the exact queued message.", lockedUrl);
    const send = exactInteractive("Send");
    if (!send.ok) return failure(send.code, send.summary, lockedUrl);
    send.element.click();
    return success("Instagram DM submitted.", lockedUrl);
  }
  if (job.actionType === "like_post") {
    if (relationship.following) return skipped("already_following", "Already following this Instagram profile; post like intentionally skipped.", lockedUrl);
    const postLinks = visibleElements('main a[href*="/p/"]').filter((element) => element.querySelector("img"));
    if (postLinks.length === 0) return failure("control_missing", "No visible Instagram post was found.", lockedUrl);
    postLinks[0].click();
    await delay(1200);
    const like = uniqueVisible('svg[aria-label="Like"]');
    if (!like.ok) return failure(like.code, "Instagram Like control was missing or ambiguous.", lockedUrl);
    const likeButton = like.element.closest("button");
    if (!likeButton) return failure("control_missing", "Instagram Like button container was missing.", lockedUrl);
    likeButton.click();
    return success("Instagram post liked.", lockedUrl);
  }
  if (job.actionType === "like_story") {
    if (relationship.following) return skipped("already_following", "Already following this Instagram profile; story like intentionally skipped.", lockedUrl);
    const story = uniqueVisible('header canvas, header img[alt*="profile picture" i]');
    if (!story.ok) return failure(story.code, "Instagram story entry was missing or ambiguous.", lockedUrl);
    const storyButton = story.element.closest("button");
    if (!storyButton) return failure("control_missing", "Instagram story button container was missing.", lockedUrl);
    storyButton.click();
    await delay(1200);
    const like = uniqueVisible('svg[aria-label="Like"]');
    if (!like.ok) return failure(like.code, "Instagram story Like control was missing or ambiguous.", lockedUrl);
    const likeButton = like.element.closest("button");
    if (!likeButton) return failure("control_missing", "Instagram story Like button container was missing.", lockedUrl);
    likeButton.click();
    return success("Instagram story liked.", lockedUrl);
  }
  return failure("unsupported_action", "Instagram connection requests are not supported.", lockedUrl);
}

function exactInteractive(label, root = document) {
  const normalized = label.toLocaleLowerCase();
  const matches = visibleElements('button, [role="button"], a', root).filter((element) => {
    const text = (element.innerText || element.getAttribute("aria-label") || "").trim().toLocaleLowerCase();
    return text === normalized && element.getAttribute("aria-pressed") !== "true";
  });
  if (matches.length === 1) return { ok: true, element: matches[0] };
  return {
    ok: false,
    code: matches.length ? "control_ambiguous" : "control_missing",
    summary: matches.length ? `${label} control is ambiguous.` : `${label} control was not found.`,
  };
}

function uniqueVisible(selector, root = document) {
  const matches = visibleElements(selector, root);
  if (matches.length === 1) return { ok: true, element: matches[0] };
  return { ok: false, code: matches.length ? "control_ambiguous" : "control_missing" };
}

function visibleElements(selector, root = document) {
  return [...root.querySelectorAll(selector)].filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  });
}

function setEditableText(element, value) {
  element.focus();
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  document.execCommand("selectAll", false);
  document.execCommand("insertText", false, String(value || ""));
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
}

function editableContains(element, value) {
  const current = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
    ? element.value
    : element.innerText || element.textContent || "";
  return current.trim() === String(value || "").trim();
}

function readRelationshipState() {
  const controlTexts = visibleElements('button, [role="button"]').map((element) =>
    String(element.innerText || element.getAttribute("aria-label") || "").trim().toLocaleLowerCase()
  );
  const pageText = String(document.body.innerText || "").toLocaleLowerCase();
  return {
    following: controlTexts.some((text) => text === "following" || text === "connected" || text === "pending" || text === "requested"),
    connected: controlTexts.some((text) => text === "connected"),
    pending: controlTexts.some((text) => text === "pending" || text === "requested"),
    followsYou: controlTexts.some((text) => text === "follow back") || /\bfollows you\b/.test(pageText),
  };
}

function hasPriorConversation(platform, textbox) {
  const root = textbox.closest('[role="dialog"]') || document.querySelector("main") || document;
  const selector = platform === "linkedin"
    ? '.msg-s-event-listitem, [data-event-urn]'
    : '[role="row"]';
  return visibleElements(selector, root).some((element) => {
    if (element.contains(textbox) || textbox.contains(element)) return false;
    const text = String(element.innerText || element.textContent || "").trim();
    return text.length > 0 && !/^(message|send|details)$/i.test(text);
  });
}

function hostMatches(platform) {
  const host = location.hostname.toLowerCase().replace(/^www\./, "");
  return host === (platform === "linkedin" ? "linkedin.com" : "instagram.com");
}

function isSignedOutPage() {
  return Boolean(document.querySelector('input[type="password"]')) || /\blog in\b|\bsign in\b/i.test(document.body.innerText.slice(0, 1200));
}

function normalizeUrl(value) {
  const parsed = new URL(value);
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function success(resultSummary, pageUrl) {
  return { outcome: "succeeded", resultSummary, pageUrl };
}

function skipped(failureCode, resultSummary, pageUrl) {
  return { outcome: "skipped", failureCode, resultSummary, pageUrl };
}

function failure(failureCode, resultSummary, pageUrl) {
  return { outcome: "failed", failureCode, resultSummary, pageUrl };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
