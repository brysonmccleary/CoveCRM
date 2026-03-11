from pathlib import Path
import re
import sys

form_path = Path("components/A2PVerificationForm.tsx")
api_path = Path("pages/api/registerA2P.ts")

form_src = form_path.read_text(encoding="utf-8")
api_src = api_path.read_text(encoding="utf-8")

# --------------------------------------------------
# 1) FRONTEND: always send useHostedCompliancePages
# --------------------------------------------------
old_payload_line = '        landingPrivacyUrl: landingPrivacyUrl || undefined,\n      };'
new_payload_line = '        landingPrivacyUrl: landingPrivacyUrl || undefined,\n        useHostedCompliancePages,\n      };'

if old_payload_line not in form_src:
    print("[refuse] Could not find payload block in A2PVerificationForm.tsx")
    sys.exit(1)

form_src = form_src.replace(old_payload_line, new_payload_line, 1)

# --------------------------------------------------
# 2) BACKEND: do NOT block submission on validation errors
#    Find the Object.keys(errors) guard and convert it to warn-only
# --------------------------------------------------
pattern = re.compile(
    r'(\n\s*if\s*\(\s*Object\.keys\(errors\)\.length\s*>\s*0\s*\)\s*\{\s*\n)(.*?)(\n\s*\}\s*\n)',
    re.DOTALL
)

m = pattern.search(api_src)
if not m:
    print("[refuse] Could not find Object.keys(errors) validation block in registerA2P.ts")
    sys.exit(1)

replacement = """
  if (Object.keys(errors).length > 0) {
    console.warn("[registerA2P] bypassing validation errors for emergency submit:", JSON.stringify(errors, null, 2));
  }
"""

api_src = api_src[:m.start()] + replacement + api_src[m.end():]

form_path.write_text(form_src, encoding="utf-8")
api_path.write_text(api_src, encoding="utf-8")

print("[patch] Updated frontend payload and disabled backend hard-block validation")
