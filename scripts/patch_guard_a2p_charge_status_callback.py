from pathlib import Path

path = Path("pages/api/a2p/status-callback.ts")
s = path.read_text()

old = """      // ✅ Bill one-time A2P approval fee when we first become truly messagingReady
      try {
        if (messagingReady) {
          await chargeA2PApprovalIfNeeded({ user });
        }
      } catch (e: any) {
        console.warn("[A2P] approval fee charge failed (non-fatal):", e?.message || e);
      }

"""

if old not in s:
    raise SystemExit("Expected charge block not found; aborting (no changes made).")

new = """      // ✅ Bill one-time A2P approval fee ONLY on first transition to messagingReady (idempotent)
      const wasReady =
        (user as any)?.registrationStatus === "ready" || (user as any)?.messagingReady === true;

      try {
        if (messagingReady && !wasReady) {
          await chargeA2PApprovalIfNeeded({ user });
        }
      } catch (e: any) {
        console.warn("[A2P] approval fee charge failed (non-fatal):", e?.message || e);
      }

"""

s = s.replace(old, new)
path.write_text(s)
print("OK: guarded A2P approval fee charge in", path)
