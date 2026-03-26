import pathlib, re, sys, shutil, datetime

TARGET = pathlib.Path("pages/api/register.ts")

if not TARGET.exists():
    print("ERROR: register.ts not found")
    sys.exit(1)

data = TARGET.read_text()

pattern = r'if \(!affiliateOwner && !isHouse\) {\s*return res\.status\(400\)\.json\(\{ message: "Invalid referral code" \}\);\s*}'
replacement = """if (!affiliateOwner && !isHouse) {
        // Allow unknown codes so Stripe promo codes or future affiliate codes don't block signup
        // If it isn't an approved affiliate, we simply don't attach referral tracking
      }"""

if not re.search(pattern, data):
    print("ERROR: expected code block not found — aborting")
    sys.exit(1)

backup = TARGET.with_suffix(".ts.bak_" + datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))
shutil.copy2(TARGET, backup)

data = re.sub(pattern, replacement, data)

TARGET.write_text(data)

print("PATCH APPLIED")
print("Backup saved to:", backup)
