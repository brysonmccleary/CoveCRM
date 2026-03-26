from pathlib import Path
import shutil
from datetime import datetime
import sys

PATH = Path("components/LeadImportPanel.tsx")

def fail(msg: str):
    print(f"[patch] ERROR: {msg}")
    sys.exit(1)

if not PATH.exists():
    fail(f"Missing file: {PATH}")

src = PATH.read_text(encoding="utf-8")
original = src

ts = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = PATH.with_suffix(PATH.suffix + f".bak_{ts}")
shutil.copy2(PATH, backup)
print(f"[patch] Backup: {backup}")

old = '''      } catch {
        /* ignore */
      }
    })();
  useEffect(() => {
    if (!folders.length) return;
'''

new = '''      } catch {
        /* ignore */
      }
    })();
  }, []);

  // If a previously-saved system folder id sneaks in, drop it (extra hardening)
  useEffect(() => {
    if (!folders.length) return;
'''

if old not in src:
    fail("Expected broken useEffect block not found")

src = src.replace(old, new, 1)

if src == original:
    print("[patch] No changes needed")
else:
    PATH.write_text(src, encoding="utf-8")
    print(f"[patch] Patched: {PATH}")
