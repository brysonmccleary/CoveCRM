#!/usr/bin/env python3
import io
import os
import re
import sys

TARGET = "pages/index.tsx"

START_MARKER = "/* Comparison Section */"
END_MARKER = "/* Pricing Section */"

OLD = "from-indigo-500 to-purple-500"
NEW = "from-blue-500 to-indigo-500"

def main():
    if not os.path.exists(TARGET):
        print(f"ERROR: missing {TARGET}")
        return 1

    with io.open(TARGET, "r", encoding="utf-8") as f:
        src = f.read()

    s = src.find(START_MARKER)
    if s == -1:
        print(f"ERROR: could not find start marker: {START_MARKER}")
        return 1

    e = src.find(END_MARKER, s)
    if e == -1:
        print(f"ERROR: could not find end marker: {END_MARKER}")
        return 1

    before = src[:s]
    block = src[s:e]
    after = src[e:]

    if NEW in block and OLD not in block:
        print("Patch already applied (blue→indigo found, old gradient not found). No changes made.")
        return 0

    if OLD not in block:
        print("ERROR: did not find expected old gradient inside comparison block.")
        print(f"Expected to find: {OLD}")
        return 1

    block2 = block.replace(OLD, NEW)

    out = before + block2 + after
    with io.open(TARGET, "w", encoding="utf-8", newline="\n") as f:
        f.write(out)

    print(f"OK: updated comparison gradients in {TARGET}: '{OLD}' -> '{NEW}' (comparison section only)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
