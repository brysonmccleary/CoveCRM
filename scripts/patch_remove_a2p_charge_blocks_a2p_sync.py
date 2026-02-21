from pathlib import Path

path = Path("pages/api/a2p/sync.ts")
s = path.read_text()

block = """        // ✅ Bill one-time A2P approval fee (idempotent)
        try {
          await chargeA2PApprovalIfNeeded({ user });
        } catch (e: any) {
          console.warn("[A2P] approval fee charge failed (non-fatal):", e?.message || e);
        }

"""

count = s.count(block)
if count != 2:
    raise SystemExit(f"Expected to find the inserted block exactly 2 times, found {count}. Aborting.")

s = s.replace(block, "", 2)
path.write_text(s)
print("OK: removed 2 charge blocks from", path)
