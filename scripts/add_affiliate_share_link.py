from __future__ import annotations
from pathlib import Path
from datetime import datetime
import shutil
import re
import sys

def backup(p: Path):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    b = p.with_suffix(p.suffix + f".bak_{ts}")
    shutil.copy2(p, b)
    print(f"[backup] {p} -> {b}")

def must_contain(text: str, needle: str, label: str, p: Path):
    if needle not in text:
        print(f"[ABORT] Missing anchor '{label}': {needle} in {p}")
        sys.exit(1)

def patch_affiliate_panel():
    p = Path("components/settings/AffiliateProgramPanel.tsx")
    if not p.exists():
        print("[ABORT] Missing file:", p)
        sys.exit(1)

    text = p.read_text(encoding="utf-8")

    # Hard anchors from your snippet
    must_contain(text, "const copyCode = () => {", "copyCode function", p)
    must_contain(text, "Your Referral Code", "referral code label", p)
    must_contain(text, '{copySuccess ? "Copied!" : "Copy Code"}', "Copy Code button label", p)
    must_contain(text, "<p className=\"text-xs\">Program Approval</p>", "Program Approval block", p)
    must_contain(text, "Refresh status", "Refresh status button", p)

    backup(p)

    # 1) Replace copyCode with copyLink behavior (copy link, not raw code)
    # Keep variable name copyCode so we don't touch other wiring, but change internals safely.
    new_copy_fn = """  const copyCode = () => {
    if (!stats?.code) return;
    const referralLink = `https://covecrm.com/signup?ref=${encodeURIComponent(
      String(stats.code),
    )}`;
    navigator.clipboard.writeText(referralLink);
    setCopySuccess(true);
    toast.success("Link copied");
    setTimeout(() => setCopySuccess(false), 1500);
  };"""

    text = re.sub(
        r"  const copyCode = \(\) => \{\n(?:.|\n)*?\n  \};",
        new_copy_fn,
        text,
        count=1,
    )

    # 2) Change button label "Copy Code" -> "Copy Link" (the ternary)
    text = text.replace('{copySuccess ? "Copied!" : "Copy Code"}',
                        '{copySuccess ? "Copied!" : "Copy Link"}')

    # 3) Insert Affiliate Link block INSIDE the Program Approval cell, directly after the Approved/Pending <p>
    # We anchor on the exact closing of that <p> from your snippet.
    approval_anchor = """                  {stats.approved ? "Approved" : "Pending"}
                </p>"""

    affiliate_link_block = """                  {stats?.code && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-300">Affiliate Link</p>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="flex-1 bg-[#1E2533] border border-white/10 rounded px-3 py-2 text-xs text-gray-200 truncate">
                          {`https://covecrm.com/signup?ref=${stats.code}`}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            navigator.clipboard.writeText(
                              `https://covecrm.com/signup?ref=${stats.code}`,
                            )
                          }
                          className="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded text-xs"
                        >
                          Copy Link
                        </button>
                      </div>
                    </div>
                  )}"""

    if "Affiliate Link" not in text:
        if approval_anchor not in text:
            print("[ABORT] Could not find exact Program Approval closing anchor to insert Affiliate Link block.")
            sys.exit(1)
        text = text.replace(approval_anchor, approval_anchor + "\n" + affiliate_link_block, 1)

    # 4) Add Copy Link button next to Refresh status at bottom
    refresh_anchor = """                Refresh status
              </button>"""

    refresh_add = """                Refresh status
              </button>

              <button
                type="button"
                onClick={() =>
                  stats?.code &&
                  navigator.clipboard.writeText(
                    `https://covecrm.com/signup?ref=${stats.code}`,
                  )
                }
                className="bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded text-xs"
              >
                Copy Link
              </button>"""

    if "Copy Link" not in text.split(refresh_anchor)[0] and refresh_anchor in text:
        text = text.replace(refresh_anchor, refresh_add, 1)
    else:
        # If anchor not found, abort (don't mess layout)
        if refresh_anchor not in text:
            print("[ABORT] Could not find Refresh status button anchor block.")
            sys.exit(1)

    p.write_text(text, encoding="utf-8")
    print("[ok] Patched", p)

def patch_app_ref_capture():
    p = Path("pages/_app.tsx")
    if not p.exists():
        print("[ABORT] Missing file:", p)
        sys.exit(1)

    text = p.read_text(encoding="utf-8")

    # Anchors from your snippet
    must_contain(text, "function InnerApp({", "InnerApp function", p)
    must_contain(text, "const router = useRouter();", "router init", p)
    must_contain(text, "import { useEffect, useMemo, useState } from \"react\";", "react hooks import", p)

    if "affiliate_code" in text and "URLSearchParams" in text and "ref" in text:
        print("[skip] _app.tsx already appears to have referral capture logic.")
        return

    backup(p)

    # Insert the useEffect right after router init (safe, client-only)
    insertion_point = "  const router = useRouter();\n"
    if insertion_point not in text:
        print("[ABORT] Could not find insertion point after router init.")
        sys.exit(1)

    capture_block = """  const router = useRouter();

  // ✅ Capture ?ref=CODE from affiliate share links (persist ~30 days)
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;

      const params = new URLSearchParams(window.location.search);
      const ref = (params.get("ref") || "").trim();
      if (!ref) return;

      // localStorage for client reads; cookie for server/API reads
      localStorage.setItem("affiliate_code", ref);
      document.cookie = `affiliate_code=${encodeURIComponent(
        ref,
      )}; path=/; max-age=2592000; SameSite=Lax`;
    } catch {
      // non-fatal
    }
  }, []);
"""

    text = text.replace(insertion_point, capture_block, 1)
    p.write_text(text, encoding="utf-8")
    print("[ok] Patched", p)

def main():
    patch_affiliate_panel()
    patch_app_ref_capture()
    print("\nDONE ✅")
    print("Next:")
    print("  git diff -- components/settings/AffiliateProgramPanel.tsx pages/_app.tsx")
    print("  npm run build")

if __name__ == "__main__":
    main()
