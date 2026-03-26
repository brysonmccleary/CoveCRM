#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from datetime import datetime
import shutil
import sys

TARGET = Path("pages/index.tsx")

def backup(path: Path) -> None:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    b = path.with_suffix(path.suffix + f".bak_{ts}")
    shutil.copy2(path, b)
    print("[patch] Backup:", b)

def main() -> None:
    if not TARGET.exists():
        print(f"[patch] ERROR: missing {TARGET}", file=sys.stderr)
        sys.exit(1)

    s = TARGET.read_text(encoding="utf-8")

    # If already correct, do nothing.
    if 'style={{ paddingTop: "56.25%" }}' in s:
        print("[patch] Already fixed. No changes.")
        return

    bad = 'style={ paddingTop: "56.25%" }'
    good = 'style={{ paddingTop: "56.25%" }}'

    if bad not in s:
        print("[patch] ERROR: expected bad style pattern not found.", file=sys.stderr)
        # Helpful hint for debugging
        import re
        m = re.search(r'style=\{[^}]*paddingTop[^}]*\}', s)
        if m:
            print("[patch] Found nearby style= {...}:", m.group(0), file=sys.stderr)
        sys.exit(1)

    backup(TARGET)
    s2 = s.replace(bad, good, 1)
    TARGET.write_text(s2, encoding="utf-8")
    print("[patch] Fixed JSX style braces for YouTube embed.")

if __name__ == "__main__":
    main()
