import io, re, sys
from pathlib import Path

path = Path("lib/twilio/syncA2P.ts")
s = path.read_text()

# 1) ensure import exists
if "chargeA2PApprovalIfNeeded" not in s:
    # add near other imports (best-effort: after existing imports)
    s = re.sub(
        r'(\nimport .*?\n)+',
        lambda m: m.group(0) + 'import { chargeA2PApprovalIfNeeded } from "@/lib/billing/trackUsage";\n',
        s,
        count=1,
        flags=re.DOTALL,
    )

# 2) insert call right under the existing comment anchor
anchor = r'// --- Bill one-time A2P approval fee on first "ready" transition ---'
if anchor not in s:
    print("ANCHOR NOT FOUND in lib/twilio/syncA2P.ts", file=sys.stderr)
    sys.exit(1)

# We expect a variable like `justApproved` in nearby code. We'll inject guarded call using a broad anchor:
# Insert immediately after the anchor comment; inside the same scope.
insertion = (
    '// --- Bill one-time A2P approval fee on first "ready" transition ---\n'
    '  try {\n'
    '    // Charge ONLY after we actually become messagingReady for the first time.\n'
    '    // This is idempotent via Stripe customer metadata (a2p_approval_charged).\n'
    '    if (justApproved) {\n'
    '      await chargeA2PApprovalIfNeeded({ user: userDoc });\n'
    '    }\n'
    '  } catch (e: any) {\n'
    '    console.warn("[A2P] approval fee charge failed (non-fatal):", e?.message || e);\n'
    '  }\n'
)

# Replace anchor line with insertion block (keeping the anchor text at top)
s2 = s.replace(anchor, insertion)
path.write_text(s2)
print("OK: patched", path)
