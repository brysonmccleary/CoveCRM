#!/usr/bin/env python3
from pathlib import Path
import re

p = Path("pages/api/sheets/connect.ts")
s = p.read_text(encoding="utf-8")
before = s

# Fix the single mis-indented comment line we introduced
s = re.sub(
    r"\n\s{4}// Compute HMAC over the EXACT BYTES that will be sent, not JS string normalization\.\n",
    "\n  // Compute HMAC over the EXACT BYTES that will be sent, not JS string normalization.\n",
    s,
    count=1,
)

if s == before:
    raise SystemExit("[FAIL] No indentation change applied (pattern not found).")

p.write_text(s, encoding="utf-8")
print("[OK] Indentation normalized in pages/api/sheets/connect.ts")
