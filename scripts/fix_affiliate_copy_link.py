from __future__ import annotations
from pathlib import Path
from datetime import datetime
import shutil, sys, re

def backup(p: Path):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    b = p.with_suffix(p.suffix + f".bak_{ts}")
    shutil.copy2(p, b)
    print(f"[backup] {p} -> {b}")

def must(text: str, needle: str, p: Path):
    if needle not in text:
        print(f"[ABORT] Missing anchor: {needle} in {p}")
        sys.exit(1)

p = Path("components/settings/AffiliateProgramPanel.tsx")
text = p.read_text(encoding="utf-8")

must(text, "toast.success", p)
must(text, "const copyCode = () => {", p)
must(text, "Refresh status", p)

backup(p)

# 1) Insert copy helper once (near copyCode function)
if "async function copyToClipboard(" not in text:
    insert_after = "  const copyCode = () => {\n"
    idx = text.find(insert_after)
    if idx == -1:
        print("[ABORT] Could not find copyCode insertion anchor.")
        sys.exit(1)

    helper = """  async function copyToClipboard(value: string) {
    try {
      // Safari can block clipboard on non-HTTPS; prefer modern API when available
      if (navigator?.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {}

    // Fallback: hidden textarea (works on Safari/localhost)
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

"""
    text = text.replace(insert_after, insert_after + helper, 1)

# 2) Rewrite copyCode to use helper (keep name to avoid wider refactors)
text = re.sub(
    r"  const copyCode = \(\) => \{\n(?:.|\n)*?\n  \};",
    """  const copyCode = async () => {
    if (!stats?.code) return;
    const referralLink = `https://covecrm.com/signup?ref=${encodeURIComponent(
      String(stats.code),
    )}`;
    const ok = await copyToClipboard(referralLink);
    setCopySuccess(true);
    ok ? toast.success("Link copied") : toast.error("Copy failed");
    setTimeout(() => setCopySuccess(false), 1500);
  };""",
    text,
    count=1,
)

# 3) Replace the other inline navigator.clipboard.writeText uses in this file with helper
# (Specifically for the Affiliate Link block + bottom button)
text = text.replace(
    "navigator.clipboard.writeText(\n                              `https://covecrm.com/signup?ref=${stats.code}`,\n                            )",
    "copyToClipboard(`https://covecrm.com/signup?ref=${stats.code}`)",
)
text = text.replace(
    "navigator.clipboard.writeText(\n                    `https://covecrm.com/signup?ref=${stats.code}`,\n                  )",
    "copyToClipboard(`https://covecrm.com/signup?ref=${stats.code}`)",
)

p.write_text(text, encoding="utf-8")
print("[ok] Patched", p)
print("Next: git diff --", p)
