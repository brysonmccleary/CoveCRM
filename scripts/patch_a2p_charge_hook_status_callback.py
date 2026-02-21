import re, sys
from pathlib import Path

path = Path("pages/api/a2p/status-callback.ts")
s = path.read_text()

# Add import
if 'chargeA2PApprovalIfNeeded' not in s:
    # Insert after existing imports
    s = re.sub(
        r'(import .*?\n)+',
        lambda m: m.group(0) + 'import { chargeA2PApprovalIfNeeded } from "@/lib/billing/trackUsage";\n',
        s,
        count=1,
        flags=re.DOTALL,
    )

# Find place after messagingReady computed
needle = r"const messagingReady = brandIsApproved && campaignIsApproved;"
if needle not in s:
    print("NEEDLE NOT FOUND", file=sys.stderr)
    sys.exit(1)

hook = (
    "const messagingReady = brandIsApproved && campaignIsApproved;\n\n"
    "      // ✅ Bill one-time A2P approval fee when we first become truly messagingReady\n"
    "      try {\n"
    "        if (messagingReady) {\n"
    "          await chargeA2PApprovalIfNeeded({ user });\n"
    "        }\n"
    "      } catch (e: any) {\n"
    "        console.warn(\"[A2P] approval fee charge failed (non-fatal):\", e?.message || e);\n"
    "      }\n"
)

s = s.replace(needle, hook)
path.write_text(s)
print("OK: patched", path)
