from pathlib import Path
import sys

path = Path("pages/api/registerA2P.ts")
src = path.read_text(encoding="utf-8")

old1 = '  const body = (req.body || {}) as BodyIn;\n  console.log("[registerA2P] incoming body keys:", Object.keys(body || {}));\n  console.log("[registerA2P] incoming body:", JSON.stringify(body, null, 2));\n  const errors: ValidationErrors = {};\n'
new1 = '  const body = (req.body || {}) as BodyIn;\n  console.log("[registerA2P] incoming body keys:", Object.keys(body || {}));\n  console.log("[registerA2P] incoming body:", JSON.stringify(body, null, 2));\n  const errors: ValidationErrors = {};\n'

old2 = 'fetch('
# we won’t replace this blindly; we’ll just verify afterward where the fetch is

if old1 not in src:
    print("[refuse] expected debug block not found")
    sys.exit(1)

# Add logs around the internal /api/a2p/start call and submit-campaign call
anchors = [
    (
        '    const startRes = await fetch(`${baseUrl}/api/a2p/start`, {',
        '    console.log("[registerA2P] forwarding to /api/a2p/start payload:", JSON.stringify(startPayload, null, 2));\n    const startRes = await fetch(`${baseUrl}/api/a2p/start`, {'
    ),
    (
        '    const startData = await startRes.json().catch(() => ({}));',
        '    const startData = await startRes.json().catch(() => ({}));\n    console.log("[registerA2P] /api/a2p/start status:", startRes.status);\n    console.log("[registerA2P] /api/a2p/start response:", JSON.stringify(startData, null, 2));'
    ),
    (
        '      const submitRes = await fetch(`${baseUrl}/api/a2p/submit-campaign`, {',
        '      console.log("[registerA2P] calling /api/a2p/submit-campaign");\n      const submitRes = await fetch(`${baseUrl}/api/a2p/submit-campaign`, {'
    ),
    (
        '      const submitData = await submitRes.json().catch(() => ({}));',
        '      const submitData = await submitRes.json().catch(() => ({}));\n      console.log("[registerA2P] /api/a2p/submit-campaign status:", submitRes.status);\n      console.log("[registerA2P] /api/a2p/submit-campaign response:", JSON.stringify(submitData, null, 2));'
    ),
]

for old, new in anchors:
    if old in src:
        src = src.replace(old, new, 1)

path.write_text(src, encoding="utf-8")
print("[patch] Added forward-response debug logs to pages/api/registerA2P.ts")
