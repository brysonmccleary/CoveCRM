from __future__ import annotations
from pathlib import Path
from datetime import datetime
import shutil, sys

def backup(p: Path):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    b = p.with_suffix(p.suffix + f".bak_{ts}")
    shutil.copy2(p, b)
    print(f"[backup] {p} -> {b}")

p = Path("components/settings/AffiliateProgramPanel.tsx")
text = p.read_text(encoding="utf-8")

# We MUST have the copyCode function already (your diff shows it exists)
anchor = "  const copyCode = async () => {"
if anchor not in text:
    print("[ABORT] Missing anchor copyCode async in AffiliateProgramPanel.tsx")
    sys.exit(1)

# If helper already exists, do nothing
if "async function copyToClipboard(value: string)" in text:
    print("[skip] copyToClipboard already present")
    sys.exit(0)

backup(p)

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

# Insert helper immediately above copyCode
text = text.replace(anchor, helper + anchor, 1)

p.write_text(text, encoding="utf-8")
print("[ok] Inserted copyToClipboard helper into", p)
print("Next: git diff --", p)
