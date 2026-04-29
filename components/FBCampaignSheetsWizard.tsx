// components/FBCampaignSheetsWizard.tsx
// 5-step Google Sheets wizard for connecting a FB lead campaign to a user-owned Google Sheet.
// Mode B (FB campaign): no folder selection, user creates the sheet themselves,
// saves via /api/facebook/connect-sheet, validates via /api/facebook/validate-sheet-setup.

import { useEffect, useRef, useState } from "react";

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseGoogleSheetUrl(input: string): {
  spreadsheetId?: string;
  gid?: string;
  error?: string;
} {
  const raw = String(input || "").trim();
  if (!raw) return { error: "Paste a Google Sheets URL." };
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (!host.includes("docs.google.com") && !host.includes("drive.google.com") && !host.includes("google.com")) {
      return { error: "That doesn't look like a Google Sheets URL." };
    }
    const m = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = m?.[1];
    const hash = (u.hash || "").replace(/^#/, "");
    const gidFromHash = hash.includes("gid=") ? new URLSearchParams(hash).get("gid") || undefined : undefined;
    const gidFromQuery = u.searchParams.get("gid") || undefined;
    const gid = gidFromHash || gidFromQuery;
    if (!spreadsheetId) return { error: "Could not detect spreadsheetId in that URL." };
    return { spreadsheetId, gid: gid || undefined };
  } catch {
    return { error: "Invalid URL. Make sure you paste the full Google Sheet link." };
  }
}

function UnverifiedAppNotice() {
  return (
    <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900 p-4">
      <div className="flex items-start gap-3">
        <div className="text-xl leading-none">⚠️</div>
        <div className="space-y-2">
          <div className="font-bold text-base text-yellow-900 dark:text-yellow-100">
            Google will show "App not verified" — this is expected.
          </div>
          <div className="text-sm text-yellow-900/90 dark:text-yellow-100/90 space-y-1">
            <div>
              The Apps Script you deploy runs <b>inside your own Google account</b> and is authorized by you.
            </div>
            <div>
              Google shows the warning because the script requests access to <b>Google Sheets</b> and the ability to{" "}
              <b>send data to CoveCRM</b> when leads arrive (HTTPS webhook).
            </div>
            <div>
              CoveCRM <b>does not</b> read your Google Drive directly and <b>never</b> stores your Google password.
            </div>
          </div>
          <div className="text-sm text-yellow-900/90 dark:text-yellow-100/90">
            <div className="font-semibold mt-1">What to click on Google's warning screen</div>
            <ol className="list-decimal pl-5 space-y-1 mt-1">
              <li>Click <b>Continue</b></li>
              <li>If you see "Google hasn't verified this app", click <b>Advanced</b></li>
              <li>Click <b>"Go to [project name] (unsafe)"</b></li>
              <li>Click <b>Allow</b></li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface FBCampaignSheetsWizardProps {
  campaignId: string;
  campaignName: string;
  leadType: string;
  initialGoogleSheetUrl?: string;
  initialAppsScriptUrl?: string;
  writeLeadsToSheet?: boolean;
  sheetHeaderValidationPassed?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function FBCampaignSheetsWizard({
  campaignId,
  campaignName,
  leadType,
  initialGoogleSheetUrl = "",
  initialAppsScriptUrl = "",
  writeLeadsToSheet = false,
  sheetHeaderValidationPassed = false,
  onClose,
  onSaved,
}: FBCampaignSheetsWizardProps) {
  const modalCardRef = useRef<HTMLDivElement>(null);

  // Wizard state
  const [step, setStep] = useState(1);

  // API data
  const [headerRowText, setHeaderRowText] = useState("");
  const [appsScriptTemplate, setAppsScriptTemplate] = useState("");
  const [loadingInstructions, setLoadingInstructions] = useState(false);

  // Step 2 — paste headers
  const [headersCopied, setHeadersCopied] = useState(false);

  // Step 3 — sheet URL
  const [sheetUrl, setSheetUrl] = useState(initialGoogleSheetUrl);
  const [sheetParsed, setSheetParsed] = useState<{ spreadsheetId?: string; gid?: string }>({});
  const [sheetUrlError, setSheetUrlError] = useState("");

  // Step 4 — Apps Script deploy
  const [ackUnverified, setAckUnverified] = useState(false);
  const [templateCopied, setTemplateCopied] = useState(false);

  // Step 5 — validate
  const [scriptUrl, setScriptUrl] = useState(initialAppsScriptUrl);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationMsg, setValidationMsg] = useState("");
  const [validationOk, setValidationOk] = useState(writeLeadsToSheet && sheetHeaderValidationPassed);
  const [saveError, setSaveError] = useState("");

  // Load sheet instructions from API on mount
  useEffect(() => {
    setLoadingInstructions(true);
    fetch(`/api/facebook/setup-sheet-instructions?campaignId=${campaignId}`)
      .then((r) => r.json())
      .then((data) => {
        setHeaderRowText(data.headerRowText || "");
        setAppsScriptTemplate(data.appsScriptTemplate || "");
      })
      .catch(() => {})
      .finally(() => setLoadingInstructions(false));
  }, [campaignId]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const copyToClipboard = async (text: string, onDone: () => void) => {
    try {
      await navigator.clipboard.writeText(text);
      onDone();
    } catch {
      alert("Could not copy automatically. Please select and copy manually.");
    }
  };

  const saveSheetUrl = async (): Promise<boolean> => {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/facebook/connect-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, googleSheetUrl: sheetUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "Failed to save sheet URL.");
        return false;
      }
      return true;
    } finally {
      setSaving(false);
    }
  };

  const validateScriptUrl = async () => {
    const trimmed = scriptUrl.trim();
    if (!trimmed) {
      setValidationMsg("Paste your Web App URL first.");
      return;
    }
    if (!/^https:\/\/script\.google\.com\//i.test(trimmed)) {
      setValidationMsg("That doesn't look like a Google Apps Script Web App URL.");
      return;
    }

    // First save the script URL
    setSaving(true);
    setSaveError("");
    try {
      const saveRes = await fetch("/api/facebook/connect-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, appsScriptUrl: trimmed }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) {
        setSaveError(saveData.error || "Failed to save script URL.");
        return;
      }
    } finally {
      setSaving(false);
    }

    // Then validate
    setValidating(true);
    setValidationMsg("");
    try {
      const res = await fetch("/api/facebook/validate-sheet-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, appsScriptUrl: trimmed }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setValidationOk(true);
        setValidationMsg("Sheet setup validated. Leads will be mirrored to your Google Sheet.");
        onSaved();
      } else {
        setValidationOk(false);
        setValidationMsg((data.errors || [data.error || "Validation failed"]).join(" "));
      }
    } finally {
      setValidating(false);
    }
  };

  const handleNextFromStep3 = async () => {
    const parsed = parseGoogleSheetUrl(sheetUrl);
    if (parsed.error) {
      setSheetUrlError(parsed.error);
      return;
    }
    setSheetParsed(parsed);
    setSheetUrlError("");
    const ok = await saveSheetUrl();
    if (ok) setStep(4);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 p-4 overflow-y-auto"
      onMouseDown={(e) => {
        if (saving || validating) return;
        if (!modalCardRef.current) return;
        if (e.target instanceof Node && !modalCardRef.current.contains(e.target)) {
          onClose();
        }
      }}
    >
      <div className="min-h-full flex items-center justify-center">
        <div
          ref={modalCardRef}
          className="w-full max-w-2xl rounded-lg bg-white dark:bg-zinc-900 shadow-lg border flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div>
              <div className="font-semibold text-lg">Connect Google Sheet</div>
              <div className="text-sm text-gray-500 truncate max-w-xs">{campaignName}</div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 px-2"
              disabled={saving || validating}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            <div className="text-sm text-gray-500">Step {step} of 5</div>

            {/* ── Step 1: Intro ── */}
            {step === 1 && (
              <div className="space-y-3">
                <div className="text-base font-semibold">
                  Step 1 — Make sure you are logged into the right Google account
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  You will create a <b>new Google Sheet that you own</b>. CoveCRM will automatically mirror every new
                  Facebook lead into that sheet in real time.
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900 p-3 text-sm text-blue-900 dark:text-blue-200">
                  <b>Important:</b> This sheet is different from the vendor lead sheets used in the regular CRM. You
                  own this sheet — it receives leads <b>from</b> CoveCRM, not the other way around.
                </div>
                <a
                  href="https://docs.google.com/spreadsheets/u/0/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block bg-zinc-800 text-white px-4 py-2 rounded hover:opacity-90"
                >
                  Open Google Sheets
                </a>
              </div>
            )}

            {/* ── Step 2: Create sheet + paste headers ── */}
            {step === 2 && (
              <div className="space-y-3">
                <div className="text-base font-semibold">Step 2 — Create a blank sheet and add the header row</div>
                <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                  <div>1. In Google Sheets, create a new blank spreadsheet.</div>
                  <div>2. Click on cell <b>A1</b>.</div>
                  <div>
                    3. Copy the header row below and paste it into row 1. Each column name will fill a separate cell.
                  </div>
                </div>

                {loadingInstructions ? (
                  <div className="text-sm text-gray-400">Loading headers…</div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Header row (tab-separated)</div>
                      <button
                        className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                        onClick={() =>
                          copyToClipboard(headerRowText, () => {
                            setHeadersCopied(true);
                            setTimeout(() => setHeadersCopied(false), 2000);
                          })
                        }
                        disabled={!headerRowText}
                      >
                        {headersCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <textarea
                      value={headerRowText}
                      readOnly
                      className="w-full h-20 border rounded p-2 font-mono text-xs"
                      placeholder="Headers loading…"
                    />
                    <div className="text-xs text-gray-500">
                      Tip: Paste with <b>Ctrl+V</b> (Windows) or <b>⌘V</b> (Mac). Google Sheets will automatically
                      split by tab into separate columns.
                    </div>
                  </div>
                )}

                <div className="text-sm text-gray-600 dark:text-gray-300">
                  4. Save the spreadsheet (it can have any name).
                </div>
              </div>
            )}

            {/* ── Step 3: Paste sheet URL ── */}
            {step === 3 && (
              <div className="space-y-3">
                <div className="text-base font-semibold">Step 3 — Paste the Google Sheet URL</div>
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  Copy the full URL from your browser address bar while the sheet is open and paste it here.
                </div>
                <input
                  value={sheetUrl}
                  onChange={(e) => {
                    setSheetUrl(e.target.value);
                    setSheetUrlError("");
                  }}
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0"
                  className="border p-2 rounded w-full"
                />
                {sheetParsed.spreadsheetId && (
                  <div className="rounded border p-3 bg-gray-50 dark:bg-zinc-800 text-sm">
                    <div>
                      <span className="font-semibold">Spreadsheet ID:</span> {sheetParsed.spreadsheetId}
                    </div>
                    {sheetParsed.gid && (
                      <div>
                        <span className="font-semibold">Tab GID:</span> {sheetParsed.gid}
                      </div>
                    )}
                  </div>
                )}
                {sheetUrlError && <div className="text-sm text-red-600">{sheetUrlError}</div>}
                {saveError && <div className="text-sm text-red-600">{saveError}</div>}
              </div>
            )}

            {/* ── Step 4: Apps Script setup ── */}
            {step === 4 && (
              <div className="space-y-3">
                <div className="text-base font-semibold">Step 4 — Set up the Apps Script Web App</div>

                <UnverifiedAppNotice />

                <div className="text-sm text-gray-700 dark:text-gray-300">
                  This script receives leads from CoveCRM and writes them to your sheet automatically. You deploy it once.
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href="https://script.google.com/home/projects/create"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                  >
                    Open Apps Script (New Project)
                  </a>
                </div>

                <ol className="list-decimal pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-3">
                  <li>
                    Click <b>Open Apps Script (New Project)</b> above.
                    <div className="text-xs text-gray-500 mt-1">
                      Always start a new project — do not use a project that already exists.
                    </div>
                  </li>
                  <li>
                    In the editor, click <b>Code.gs</b>, then <b>select all</b> and paste the CoveCRM script so it{" "}
                    <b>replaces everything</b>.
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">Apps Script template</div>
                        <button
                          className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                          onClick={() =>
                            copyToClipboard(appsScriptTemplate, () => {
                              setTemplateCopied(true);
                              setTimeout(() => setTemplateCopied(false), 2000);
                            })
                          }
                          disabled={!appsScriptTemplate}
                        >
                          {templateCopied ? "Copied!" : "Copy"}
                        </button>
                      </div>
                      <textarea
                        value={appsScriptTemplate}
                        readOnly
                        className="w-full h-48 border rounded p-2 font-mono text-xs"
                        placeholder="Template loading…"
                      />
                    </div>
                  </li>
                  <li>
                    <b>Save</b> the project (<b>⌘S</b> / <b>Ctrl+S</b>).
                  </li>
                  <li>
                    Click <b>Deploy → New deployment</b>.
                    <div className="text-xs text-gray-500 mt-1">
                      If you don't see "Deploy" in the toolbar, save first.
                    </div>
                  </li>
                  <li>
                    Set:
                    <ul className="list-disc pl-5 mt-1 space-y-1 text-xs">
                      <li><b>Select type:</b> Web app</li>
                      <li><b>Execute as:</b> Me</li>
                      <li><b>Who has access:</b> Anyone</li>
                    </ul>
                  </li>
                  <li>
                    Click <b>Deploy</b>. Approve permissions when prompted.
                    <div className="text-xs text-gray-500 mt-1">
                      See the warning notice above if Google shows "App not verified".
                    </div>
                  </li>
                  <li>
                    Copy the <b>Web App URL</b> from the deployment dialog. You'll paste it in the next step.
                  </li>
                </ol>

                <label className="flex items-start gap-2 text-sm rounded border bg-white dark:bg-zinc-900 p-3">
                  <input
                    type="checkbox"
                    checked={ackUnverified}
                    onChange={(e) => setAckUnverified(e.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-gray-700 dark:text-gray-200">
                    I understand the <b>"Google hasn't verified this app"</b> warning is expected, and I will click{" "}
                    <b>Advanced → Go to (unsafe) → Allow</b>.
                  </span>
                </label>
              </div>
            )}

            {/* ── Step 5: Paste Web App URL + validate ── */}
            {step === 5 && (
              <div className="space-y-3">
                <div className="text-base font-semibold">Step 5 — Paste your Web App URL and validate</div>
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  After deploying, go back to the Apps Script editor, click <b>Deploy → Manage deployments</b>, and copy
                  the <b>Web App URL</b>.
                </div>
                <input
                  value={scriptUrl}
                  onChange={(e) => {
                    setScriptUrl(e.target.value);
                    setValidationMsg("");
                    setValidationOk(false);
                  }}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="border p-2 rounded w-full"
                />
                {validationMsg && (
                  <div
                    className={`text-sm ${validationOk ? "text-green-600" : "text-red-600"}`}
                  >
                    {validationOk ? "✅ " : "❌ "}
                    {validationMsg}
                  </div>
                )}
                {saveError && <div className="text-sm text-red-600">{saveError}</div>}

                {validationOk && (
                  <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/20 dark:border-green-900 p-3 text-sm text-green-900 dark:text-green-200">
                    Your Google Sheet is connected. CoveCRM will automatically mirror new leads to your sheet.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 gap-2 flex-wrap">
            <button
              onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
              className="text-gray-500 hover:text-gray-700 text-sm px-3 py-1.5"
              disabled={saving || validating}
            >
              {step === 1 ? "Cancel" : "← Back"}
            </button>

            <div className="flex items-center gap-2">
              {step < 5 && (
                <button
                  onClick={async () => {
                    if (step === 3) {
                      await handleNextFromStep3();
                    } else if (step === 4) {
                      if (!ackUnverified) return;
                      setStep(5);
                    } else {
                      setStep(step + 1);
                    }
                  }}
                  disabled={
                    saving ||
                    (step === 4 && !ackUnverified) ||
                    (step === 3 && !sheetUrl.trim())
                  }
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm px-4 py-1.5 rounded"
                >
                  {saving ? "Saving…" : "Next →"}
                </button>
              )}

              {step === 5 && !validationOk && (
                <button
                  onClick={validateScriptUrl}
                  disabled={validating || saving || !scriptUrl.trim()}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm px-4 py-1.5 rounded"
                >
                  {validating || saving ? "Validating…" : "Validate & Save"}
                </button>
              )}

              {step === 5 && validationOk && (
                <button
                  onClick={onClose}
                  className="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-1.5 rounded"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
