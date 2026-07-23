window.addEventListener("message", async (event) => {
  if (event.source !== window || event.data?.type !== "COVE_PAIR_COMPANION") return;
  const response = await chrome.runtime.sendMessage({
    type: "PAIR",
    pairingCode: String(event.data.pairingCode || ""),
    apiBase: String(event.data.apiBase || ""),
    consentAccepted: event.data.consentAccepted === true,
  });
  window.postMessage({ type: "COVE_PAIR_COMPANION_RESULT", response }, window.location.origin);
});
