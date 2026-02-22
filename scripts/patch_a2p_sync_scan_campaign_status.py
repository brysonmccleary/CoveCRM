from pathlib import Path

path = Path("pages/api/a2p/sync.ts")
s = path.read_text()

old = "const campaignStatus = (c as any)?.status || (c as any)?.state;"
new = "const campaignStatus = (c as any)?.campaignStatus || (c as any)?.campaign_status || (c as any)?.status || (c as any)?.state;"

if old not in s:
    print("ERROR: expected scan campaignStatus line not found. Aborting.")
    raise SystemExit(1)

s = s.replace(old, new, 1)
path.write_text(s)
print("OK: patched", path)
