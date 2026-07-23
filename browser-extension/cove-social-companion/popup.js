const status = document.querySelector("#status");
const pairing = document.querySelector("#pairing");
const controls = document.querySelector("#controls");
const error = document.querySelector("#error");
const enabled = document.querySelector("#enabled");

void refresh();

document.querySelector("#pair").addEventListener("click", async () => {
  error.textContent = "";
  const pairingCode = document.querySelector("#pairingCode").value.trim().toUpperCase();
  const apiBase = document.querySelector("#apiBase").value.trim();
  const consentAccepted = document.querySelector("#consent").checked;
  const response = await chrome.runtime.sendMessage({ type: "PAIR", pairingCode, apiBase, consentAccepted });
  if (!response?.ok) {
    error.textContent = response?.error || "Pairing failed.";
    return;
  }
  await refresh();
});

enabled.addEventListener("change", async () => {
  await chrome.runtime.sendMessage({ type: "SET_LOCAL_PAUSE", paused: !enabled.checked });
  if (enabled.checked) await chrome.runtime.sendMessage({ type: "POLL_NOW" });
  await refresh();
});

document.querySelector("#poll").addEventListener("click", async () => {
  error.textContent = "";
  const response = await chrome.runtime.sendMessage({ type: "POLL_NOW" });
  if (!response?.ok) error.textContent = response?.error || "Queue check failed.";
  await refresh();
});

async function refresh() {
  const state = await chrome.storage.local.get([
    "deviceToken",
    "companion",
    "locallyPaused",
    "lastState",
    "lastError"
  ]);
  const paired = Boolean(state.deviceToken && state.companion);
  pairing.hidden = paired;
  controls.hidden = !paired;
  if (!paired) {
    status.textContent = "Not paired";
    return;
  }
  enabled.checked = !state.locallyPaused;
  document.querySelector("#companionLabel").textContent = state.companion.label;
  status.textContent = state.locallyPaused ? "Paused locally" : `Enabled · ${state.lastState || "waiting"}`;
  error.textContent = state.lastState === "error" ? (state.lastError || "Companion error") : "";
}
