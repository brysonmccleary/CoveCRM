import pathlib, re, sys

FILES = [
  "pages/api/a2p/sync-status.ts",
  "pages/api/cron/check-a2p-status.ts",
]

def patch_sync_status(src: str) -> str:
  orig = src

  # Insert bearer extraction right after headerKey line
  marker = r'const headerKey = String\(req\.headers\["x-cron-key"\] \|\| ""\);\n'
  if re.search(marker, src) is None:
    print("ERROR: sync-status marker not found for headerKey line.")
    sys.exit(1)

  insert = (
    'const headerKey = String(req.headers["x-cron-key"] || "");\n'
    '    const authHeader = String(req.headers["authorization"] || "");\n'
    '    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";\n'
  )

  src = re.sub(marker, insert, src, count=1)

  # Expand auth check to include bearer
  old_check = r'if \(CRON_KEY && token !== CRON_KEY && headerKey !== CRON_KEY\) {'
  if re.search(old_check, src) is None:
    print("ERROR: sync-status auth check not found.")
    sys.exit(1)

  new_check = 'if (CRON_KEY && token !== CRON_KEY && headerKey !== CRON_KEY && bearer !== CRON_KEY) {'
  src = re.sub(old_check, new_check, src, count=1)

  if src == orig:
    print("ERROR: sync-status unchanged unexpectedly.")
    sys.exit(1)
  return src

def patch_check_a2p(src: str) -> str:
  orig = src

  # Find the token line block and add Authorization bearer support.
  # We insert bearer extraction just before the token const, then include bearer in token selection.
  token_pat = r'const token = \(req\.query\.token \|\| req\.headers\["x-cron-token"\] \|\| req\.headers\["x-cron-key"\]\) as'
  if re.search(token_pat, src) is None:
    print("ERROR: check-a2p-status token pattern not found.")
    sys.exit(1)

  # Insert bearer extraction above token line (within the CRON_SECRET block)
  src = re.sub(
    token_pat,
    'const authHeader = String(req.headers["authorization"] || "");\n'
    '      const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";\n'
    '      const token = (req.query.token || req.headers["x-cron-token"] || req.headers["x-cron-key"] || bearer) as',
    src,
    count=1
  )

  if src == orig:
    print("ERROR: check-a2p-status unchanged unexpectedly.")
    sys.exit(1)
  return src

for f in FILES:
  p = pathlib.Path(f)
  s = p.read_text()
  if f.endswith("pages/api/a2p/sync-status.ts"):
    out = patch_sync_status(s)
  else:
    out = patch_check_a2p(s)
  p.write_text(out)
  print("OK patched", f)
