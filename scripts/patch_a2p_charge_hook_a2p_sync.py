import re, sys
from pathlib import Path

path = Path("pages/api/a2p/sync.ts")
s = path.read_text()

if 'chargeA2PApprovalIfNeeded' not in s:
    s = re.sub(
        r'(import .*?\n)+',
        lambda m: m.group(0) + 'import { chargeA2PApprovalIfNeeded } from "@/lib/billing/trackUsage";\n',
        s,
        count=1,
        flags=re.DOTALL,
    )

# Insert in fast-path branch after A2PProfile.updateOne(...) sets approved fields
# Anchor on the specific $set block that includes messagingReady: true, applicationStatus: "approved"
fast_anchor = r'messagingReady: true,\s*\n\s*applicationStatus: "approved",'
if not re.search(fast_anchor, s):
    print("FAST ANCHOR NOT FOUND", file=sys.stderr)
    sys.exit(1)

# We'll hook shortly after the updateOne call completes in that branch by anchoring on the closing `);`
# closest after the approval updateOne in fast path.
# Best-effort: insert after first occurrence of `await A2PProfile.updateOne(` that contains messagingReady true block.
pattern = r'(await A2PProfile\.updateOne\([\s\S]{0,2000}?messagingReady:\s*true,[\s\S]{0,2000}?\);\n)'
m = re.search(pattern, s)
if not m:
    print("FAST PATH UPDATEONE BLOCK NOT FOUND", file=sys.stderr)
    sys.exit(1)

insert = m.group(1) + (
    "\n        // ✅ Bill one-time A2P approval fee (idempotent)\n"
    "        try {\n"
    "          await chargeA2PApprovalIfNeeded({ user });\n"
    "        } catch (e: any) {\n"
    "          console.warn(\"[A2P] approval fee charge failed (non-fatal):\", e?.message || e);\n"
    "        }\n"
)
s = s.replace(m.group(1), insert, 1)

# Insert in isCampaignApproved branch after it sets approved fields
pattern2 = r'(if \(isCampaignApproved\) \{\n[\s\S]{0,3000}?await A2PProfile\.updateOne\([\s\S]{0,2500}?messagingReady:\s*true,[\s\S]{0,2500}?\);\n)'
m2 = re.search(pattern2, s)
if not m2:
    print("CAMPAIGN APPROVED BRANCH UPDATEONE BLOCK NOT FOUND", file=sys.stderr)
    sys.exit(1)

insert2 = m2.group(1) + (
    "\n        // ✅ Bill one-time A2P approval fee (idempotent)\n"
    "        try {\n"
    "          await chargeA2PApprovalIfNeeded({ user });\n"
    "        } catch (e: any) {\n"
    "          console.warn(\"[A2P] approval fee charge failed (non-fatal):\", e?.message || e);\n"
    "        }\n"
)
s = s.replace(m2.group(1), insert2, 1)

path.write_text(s)
print("OK: patched", path)
