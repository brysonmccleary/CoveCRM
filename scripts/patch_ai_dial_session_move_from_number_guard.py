#!/usr/bin/env python3
from __future__ import annotations
import sys
from pathlib import Path

FILE = Path("pages/ai-dial-session.tsx")

MARK = "  // If switching accounts, clear any saved dial number that isn't owned by this account.\n"
END = "  }, [numbers, selectedFromNumber]);\n"

def main() -> int:
    if not FILE.exists():
        print(f"ERROR: missing {FILE}", file=sys.stderr)
        return 1

    s = FILE.read_text(encoding="utf-8")

    start = s.find(MARK)
    if start == -1:
        print("ERROR: guard block start marker not found", file=sys.stderr)
        return 1

    end = s.find(END, start)
    if end == -1:
        print("ERROR: guard block end marker not found", file=sys.stderr)
        return 1
    end += len(END)

    block = s[start:end]
    if "useEffect(() =>" not in block or "setSelectedFromNumber" not in block:
        print("ERROR: safety check failed; extracted block doesn't look right", file=sys.stderr)
        return 1

    s_removed = s[:start] + s[end:]

    anchor = 'const [selectedFromNumber, setSelectedFromNumber] = useState<string>("");'
    a = s_removed.find(anchor)
    if a == -1:
        # fallback if typing differs slightly
        anchor2 = "const [selectedFromNumber, setSelectedFromNumber]"
        a = s_removed.find(anchor2)
        if a == -1:
            print("ERROR: could not find selectedFromNumber state hook anchor", file=sys.stderr)
            return 1
        line_end = s_removed.find("\n", a)
    else:
        line_end = s_removed.find("\n", a)

    if line_end == -1:
        print("ERROR: could not find end-of-line after selectedFromNumber hook", file=sys.stderr)
        return 1

    insert_at = line_end + 1
    s_fixed = s_removed[:insert_at] + "\n" + block + s_removed[insert_at:]

    FILE.write_text(s_fixed, encoding="utf-8")
    print("OK: moved guard block below selectedFromNumber declaration")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
