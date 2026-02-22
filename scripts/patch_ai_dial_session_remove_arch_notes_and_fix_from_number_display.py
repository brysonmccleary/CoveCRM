#!/usr/bin/env python3
from __future__ import annotations
import sys
from pathlib import Path

FILE = Path("pages/ai-dial-session.tsx")

ARCH_START = '<div className="text-xs text-gray-400">'
ARCH_MARK = "Architecture notes (for later wiring):"

def main() -> int:
    if not FILE.exists():
        print(f"ERROR: missing {FILE}", file=sys.stderr)
        return 1

    s = FILE.read_text(encoding="utf-8")

    # -----------------------------
    # 1) Remove Architecture notes block (exactly that div)
    # -----------------------------
    start_idx = s.find(ARCH_START)
    if start_idx == -1:
        print("ERROR: could not find Architecture notes container div start", file=sys.stderr)
        return 1

    mark_idx = s.find(ARCH_MARK, start_idx)
    if mark_idx == -1:
        print("ERROR: could not find 'Architecture notes (for later wiring):' marker", file=sys.stderr)
        return 1

    # Find the end of THAT div (the first closing </div> after the marker)
    end_div_idx = s.find("</div>", mark_idx)
    if end_div_idx == -1:
        print("ERROR: could not find closing </div> for Architecture notes container", file=sys.stderr)
        return 1
    end_div_idx += len("</div>")

    removed_block = s[start_idx:end_div_idx]
    if ARCH_MARK not in removed_block:
        print("ERROR: safety check failed; removal block did not contain marker", file=sys.stderr)
        return 1

    s2 = s[:start_idx] + s[end_div_idx:]

    # -----------------------------
    # 2) Clear stale selectedFromNumber if it isn't owned by this account
    #    (prevents old account number showing on test account)
    # -----------------------------
    # We insert AFTER the numbers state hook declaration so we don't reference TDZ.
    needle = "const [numbers, setNumbers]"
    pos = s2.find(needle)
    if pos == -1:
        print("ERROR: could not find numbers state hook (const [numbers, setNumbers])", file=sys.stderr)
        return 1

    # Insert after the end of that line
    line_end = s2.find("\n", pos)
    if line_end == -1:
        print("ERROR: could not locate end of numbers state hook line", file=sys.stderr)
        return 1
    insert_at = line_end + 1

    guard_block = (
        "\n"
        "  // If switching accounts, clear any saved dial number that isn't owned by this account.\n"
        "  useEffect(() => {\n"
        "    if (!selectedFromNumber) return;\n"
        "    if (!Array.isArray(numbers) || numbers.length === 0) return;\n"
        "    const ok = numbers.some((n) => n.phoneNumber === selectedFromNumber);\n"
        "    if (ok) return;\n"
        "    setSelectedFromNumber(\"\");\n"
        "    try {\n"
        "      localStorage.removeItem(\"selectedDialNumber\");\n"
        "    } catch {}\n"
        "  }, [numbers, selectedFromNumber]);\n"
    )

    # Safety: do not double-insert
    if "clear any saved dial number that isn't owned by this account" in s2:
        print("ERROR: guard block already present; refusing to insert twice", file=sys.stderr)
        return 1

    s3 = s2[:insert_at] + guard_block + s2[insert_at:]

    FILE.write_text(s3, encoding="utf-8")
    print("OK: patched pages/ai-dial-session.tsx")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
