#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from datetime import datetime
import shutil, sys

TARGET = Path("pages/index.tsx")

def backup(p: Path):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    b = p.with_suffix(p.suffix + f".bak_{ts}")
    shutil.copy2(p, b)
    print("[patch] Backup:", b)

def main():
    if not TARGET.exists():
        print(f"[patch] ERROR: missing {TARGET}", file=sys.stderr)
        sys.exit(1)

    s = TARGET.read_text(encoding="utf-8")

    old = "See CoveCRM in action in under 2 minutes."
    new = "See CoveCRM in action."

    if old not in s:
        # fallback: just remove the phrase if copy was edited slightly
        if "under 2 minutes" not in s:
            print("[patch] ERROR: did not find expected demo duration copy.", file=sys.stderr)
            sys.exit(1)
        backup(TARGET)
        s2 = s.replace(" in under 2 minutes", "", 1)
        TARGET.write_text(s2, encoding="utf-8")
        print("[patch] Removed 'under 2 minutes' phrase.")
        return

    backup(TARGET)
    s2 = s.replace(old, new, 1)
    TARGET.write_text(s2, encoding="utf-8")
    print("[patch] Updated demo copy to remove 2-minute claim.")

if __name__ == "__main__":
    main()
