import pathlib, re, sys

path = pathlib.Path("pages/api/cron/check-a2p-status.ts")
s = path.read_text()

orig = s

# 1) Expand token sources to include x-cron-key
# Current line:
# const token = (req.query.token || req.headers["x-cron-token"]) as ...
pat = r'const token = \(req\.query\.token \|\| req\.headers\["x-cron-token"\]\) as'
if re.search(pat, s) is None:
    print("ERROR: token line pattern not found. Aborting.")
    sys.exit(1)

s = re.sub(
    pat,
    'const token = (req.query.token || req.headers["x-cron-token"] || req.headers["x-cron-key"]) as',
    s,
    count=1
)

# 2) Bypass mongoose validation when saving status updates
# Replace ONLY the exact save call inside the changed block
if "await profile.save();" not in s:
    print("ERROR: expected 'await profile.save();' not found. Aborting.")
    sys.exit(1)

s = s.replace("await profile.save();", "await profile.save({ validateBeforeSave: false });", 1)

if s == orig:
    print("No changes made (unexpected). Aborting.")
    sys.exit(1)

path.write_text(s)
print("OK: patched", path)
