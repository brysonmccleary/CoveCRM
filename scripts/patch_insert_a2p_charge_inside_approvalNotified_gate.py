from pathlib import Path

path = Path("pages/api/a2p/sync.ts")
s = path.read_text()

needle = "        if (!doc.approvalNotifiedAt) {\n"
if s.count(needle) != 2:
    raise SystemExit(f"Expected 2 occurrences of approvalNotifiedAt gate, found {s.count(needle)}. Aborting.")

insertion = needle + """          // ✅ Bill one-time A2P approval fee ONLY once on first approval notification (idempotent)
          try {
            await chargeA2PApprovalIfNeeded({ user });
          } catch (e: any) {
            console.warn("[A2P] approval fee charge failed (non-fatal):", e?.message || e);
          }

"""

s = s.replace(needle, insertion, 2)
path.write_text(s)
print("OK: inserted charge inside approvalNotifiedAt gate in", path)
