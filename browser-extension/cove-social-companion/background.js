const ALARM_NAME = "cove-social-poll";
const DEFAULT_API_BASE = "https://www.covecrm.com";
let running = false;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  const state = await chrome.storage.local.get(["installationId", "apiBase", "locallyPaused"]);
  if (!state.installationId) {
    await chrome.storage.local.set({ installationId: crypto.randomUUID().replaceAll("-", "") });
  }
  if (!state.apiBase) await chrome.storage.local.set({ apiBase: DEFAULT_API_BASE });
  if (typeof state.locallyPaused !== "boolean") await chrome.storage.local.set({ locallyPaused: true });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void pollOnce();
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const state = await chrome.storage.local.get(["runnerWindowId"]);
  if (state.runnerWindowId === windowId) await chrome.storage.local.remove("runnerWindowId");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PAIR") {
    pair(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "SET_LOCAL_PAUSE") {
    chrome.storage.local.set({ locallyPaused: Boolean(message.paused) })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "POLL_NOW") {
    pollOnce().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

async function pair({ pairingCode, apiBase, consentAccepted }) {
  if (!consentAccepted) throw new Error("The companion agreement must be accepted.");
  const state = await chrome.storage.local.get(["installationId"]);
  const normalizedBase = normalizeApiBase(apiBase || DEFAULT_API_BASE);
  const response = await fetch(`${normalizedBase}/api/recruiting/companion/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pairingCode,
      installationId: state.installationId,
      consentAccepted: true,
      consentVersion: "2026-07-16.1",
      extensionVersion: chrome.runtime.getManifest().version,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Pairing failed.");
  await chrome.storage.local.set({
    apiBase: normalizedBase,
    deviceToken: data.deviceToken,
    companion: data.companion,
    locallyPaused: false,
    lastState: "paired_ready",
  });
  return { ok: true, companion: data.companion };
}

async function pollOnce() {
  if (running) return;
  running = true;
  try {
    const state = await chrome.storage.local.get(["apiBase", "deviceToken", "locallyPaused", "lastSessionHealthCheckAt"]);
    if (!state.deviceToken || state.locallyPaused) return;
    if (!state.lastSessionHealthCheckAt || Date.now() - Date.parse(state.lastSessionHealthCheckAt) >= 15 * 60_000) {
      await refreshLoggedOutSessions(state.apiBase, state.deviceToken);
      await chrome.storage.local.set({ lastSessionHealthCheckAt: new Date().toISOString() });
    }
    const discovery = await claimDiscovery(state.apiBase, state.deviceToken);
    if (discovery) {
      await executeDiscovery(state.apiBase, state.deviceToken, discovery);
      return;
    }
    for (let actionNumber = 0; actionNumber < 3; actionNumber += 1) {
      const response = await fetch(`${state.apiBase}/api/recruiting/companion/claim`, {
        method: "POST",
        headers: { Authorization: `Bearer ${state.deviceToken}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Job claim failed.");
      await chrome.storage.local.set({ lastState: data.state, lastPollAt: new Date().toISOString() });
      if (!data.job) break;
      await executeJob(state.apiBase, state.deviceToken, data.job);
    }
  } catch (error) {
    await chrome.storage.local.set({ lastState: "error", lastError: String(error?.message || error) });
  } finally {
    running = false;
  }
}

async function refreshLoggedOutSessions(apiBase, deviceToken) {
  const response = await fetch(`${apiBase}/api/recruiting/companion/session-status`, {
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not check platform sessions.");
  const loggedOut = (data.sessions || []).filter((session) => session.status === "logged_out");
  for (const session of loggedOut) {
    const url = session.platform === "linkedin" ? "https://linkedin.com/feed/" : "https://instagram.com/";
    let tab;
    try {
      tab = await createRunnerTab(url);
      await waitForTabComplete(tab.id, 30_000);
      const result = await chrome.tabs.sendMessage(tab.id, { type: "CHECK_COVE_SESSION" });
      if (result?.loggedIn) await reportSession(apiBase, deviceToken, session.platform, "active");
    } finally {
      if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
  }
}

async function claimDiscovery(apiBase, deviceToken) {
  const response = await fetch(`${apiBase}/api/recruiting/discovery/claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Discovery claim failed.");
  return data.job || null;
}

async function executeDiscovery(apiBase, deviceToken, job) {
  const searchUrl = job.platform === "linkedin"
    ? `https://linkedin.com/search/results/people/?keywords=${encodeURIComponent(job.searchQuery)}`
    : `https://instagram.com/explore/search/keyword/?q=${encodeURIComponent(job.searchQuery)}`;
  let tab;
  let candidates = [];
  let error = "";
  try {
    tab = await createRunnerTab(searchUrl);
    await waitForTabComplete(tab.id, 30_000);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const localState = await chrome.storage.local.get(["locallyPaused"]);
    if (localState.locallyPaused) throw new Error("Companion was paused locally during discovery.");
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "DISCOVER_COVE_CANDIDATES",
      platform: job.platform,
      maxCandidates: job.maxCandidates,
    });
    candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    error = String(result?.error || "");
    await reportSession(apiBase, deviceToken, job.platform, /not signed in/i.test(error) ? "logged_out" : "active");
  } catch (caught) {
    error = String(caught?.message || caught);
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
  const response = await fetch(`${apiBase}/api/recruiting/discovery/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ jobId: job.id, candidates, error }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Discovery completion failed.");
  await chrome.storage.local.set({ lastState: `discovered_${data.accepted}`, lastDiscoveryAt: new Date().toISOString() });
}

async function executeJob(apiBase, deviceToken, job) {
  let tab;
  try {
    const lockedUrl = normalizeSocialUrl(job.platform, job.targetSnapshot.profileUrl);
    tab = await createRunnerTab(lockedUrl);
    await waitForTabComplete(tab.id, 30_000);
    const localState = await chrome.storage.local.get(["locallyPaused"]);
    if (localState.locallyPaused) throw new Error("Companion was paused locally before execution.");
    await authorizeJob(apiBase, deviceToken, job);
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "EXECUTE_COVE_JOB",
      job,
      lockedUrl,
    });
    await reportSession(apiBase, deviceToken, job.platform, result?.failureCode === "not_logged_in" ? "logged_out" : "active");
    await completeJob(apiBase, deviceToken, job, result || {
      outcome: "failed",
      failureCode: "execution_error",
      resultSummary: "Content script returned no result.",
      pageUrl: lockedUrl,
    });
  } catch (error) {
    await completeJob(apiBase, deviceToken, job, {
      outcome: "failed",
      failureCode: "execution_error",
      resultSummary: String(error?.message || error).slice(0, 500),
      pageUrl: job.targetSnapshot.profileUrl,
    });
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function reportSession(apiBase, deviceToken, platform, status) {
  const response = await fetch(`${apiBase}/api/recruiting/companion/session-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ platform, status }),
  });
  if (!response.ok) throw new Error("Could not update platform login status.");
}

async function createRunnerTab(url) {
  const windowId = await getRunnerWindowId();
  return chrome.tabs.create({ windowId, url, active: false });
}

async function getRunnerWindowId() {
  const state = await chrome.storage.local.get(["runnerWindowId"]);
  if (Number.isInteger(state.runnerWindowId)) {
    try {
      const existing = await chrome.windows.get(state.runnerWindowId);
      if (existing?.id) {
        if (existing.state !== "minimized") await chrome.windows.update(existing.id, { state: "minimized", focused: false });
        return existing.id;
      }
    } catch {
      await chrome.storage.local.remove("runnerWindowId");
    }
  }
  const runner = await chrome.windows.create({
    url: "about:blank",
    type: "normal",
    focused: false,
    state: "minimized",
  });
  if (!runner?.id) throw new Error("Could not create the background recruiting window.");
  await chrome.storage.local.set({ runnerWindowId: runner.id });
  return runner.id;
}

async function authorizeJob(apiBase, deviceToken, job) {
  const response = await fetch(`${apiBase}/api/recruiting/companion/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ jobId: job.id, recipientLock: job.recipientLock }),
  });
  const data = await response.json();
  if (!response.ok || !data.authorized) throw new Error(data.error || "Job authorization was revoked.");
}

async function completeJob(apiBase, deviceToken, job, result) {
  const response = await fetch(`${apiBase}/api/recruiting/companion/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({
      jobId: job.id,
      recipientLock: job.recipientLock,
      outcome: result.outcome,
      failureCode: result.failureCode,
      resultSummary: result.resultSummary,
      pageUrl: result.pageUrl,
    }),
  });
  const data = await response.json();
  if (response.status === 409) {
    await chrome.storage.local.set({ lastState: "revoked", lastError: data.error || "Job lease was revoked." });
    return;
  }
  if (!response.ok) throw new Error(data.error || "Job completion failed.");
  await chrome.storage.local.set({ lastState: data.status, lastActionAt: new Date().toISOString() });
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Target page timed out."));
    }, timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function normalizeApiBase(value) {
  const parsed = new URL(String(value || "").trim());
  const local = parsed.protocol === "http:" && parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !local) throw new Error("CoveCRM URL must use HTTPS.");
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeSocialUrl(platform, value) {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const expected = platform === "linkedin" ? "linkedin.com" : "instagram.com";
  if (parsed.protocol !== "https:" || host !== expected) throw new Error("Locked target URL is invalid.");
  parsed.hostname = expected;
  const segments = parsed.pathname.split("/").filter(Boolean);
  const exactLinkedInProfile = platform === "linkedin" && segments.length === 2 && segments[0].toLowerCase() === "in";
  const reservedInstagram = new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories"]);
  const exactInstagramProfile = platform === "instagram" && segments.length === 1 && /^[a-zA-Z0-9._]{1,30}$/.test(segments[0]) && !reservedInstagram.has(segments[0].toLowerCase());
  if (!exactLinkedInProfile && !exactInstagramProfile) throw new Error("Locked target is not an exact profile URL.");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}
