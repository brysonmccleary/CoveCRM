from pathlib import Path

path = Path("lib/twilio/syncA2P.ts")
s = path.read_text()

block = """  // --- Bill one-time A2P approval fee on first "ready" transition ---
  try {
    // Charge ONLY after we actually become messagingReady for the first time.
    // This is idempotent via Stripe customer metadata (a2p_approval_charged).
    if (justApproved) {
      await chargeA2PApprovalIfNeeded({ user: userDoc });
    }
  } catch (e: any) {
    console.warn("[A2P] approval fee charge failed (non-fatal):", e?.message || e);
  }

"""

if block not in s:
    raise SystemExit("Expected duplicate block not found; aborting (no changes made).")

s = s.replace(block, '  // --- Bill one-time A2P approval fee on first "ready" transition ---\n')
path.write_text(s)
print("OK: removed duplicate charge block from", path)
