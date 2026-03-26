#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime
import shutil

PATH = Path("pages/api/stripe/create-checkout-session.ts")

old = '''      metadata: {
        userId: (user as any)?._id?.toString?.() || "",
        email: user.email,
        upgradeIncluded: wantsUpgrade ? "true" : "false",
        referralCodeUsed: enteredCode || "none",
      },'''

new = '''      metadata: {
        userId: (user as any)?._id?.toString?.() || "",
        email: user.email,
        upgradeIncluded: wantsUpgrade ? "true" : "false",
        referralCodeUsed: enteredCode || "none",
      },
      subscription_data: {
        metadata: {
          userId: (user as any)?._id?.toString?.() || "",
          email: user.email,
          upgradeIncluded: wantsUpgrade ? "true" : "false",
          referralCodeUsed: enteredCode || "none",
          appliedPromoCode: enteredCode || "none",
        },
      },'''

def backup(path: Path):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = path.with_suffix(path.suffix + f".bak_{ts}")
    shutil.copy2(path, bak)
    print(f"[backup] {path} -> {bak}")

def main():
    text = PATH.read_text(encoding="utf-8")

    if 'subscription_data: {' in text and 'appliedPromoCode: enteredCode || "none",' in text:
        print("[skip] subscription metadata already present")
        return

    if old not in text:
        print("[error] target block not found exactly")
        return

    backup(PATH)
    text = text.replace(old, new, 1)
    PATH.write_text(text, encoding="utf-8")
    print(f"[patched] {PATH}")

if __name__ == "__main__":
    main()
