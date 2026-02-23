#!/usr/bin/env python3
from pathlib import Path
import sys

path = Path("pages/index.tsx")
s = path.read_text(encoding="utf-8")

needle = 'AI Dialer – Your 24/7 Appointment Setter <span className="ml-2 inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white/80">Early Access</span>'

if needle not in s:
    print("ERROR: Could not find existing Early Access badge.", file=sys.stderr)
    sys.exit(1)

replacement = '''AI Dialer – Your 24/7 Appointment Setter 
                <span className="ml-3 inline-flex items-center rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 px-3 py-1 text-xs font-bold text-white shadow-lg animate-pulse">
                  Join AI Dialer Waitlist
                </span>'''

s2 = s.replace(needle, replacement, 1)

if s2 == s:
    print("ERROR: Patch made no changes.", file=sys.stderr)
    sys.exit(1)

path.write_text(s2, encoding="utf-8")
print("OK: Upgraded AI Dialer badge to Waitlist CTA")
