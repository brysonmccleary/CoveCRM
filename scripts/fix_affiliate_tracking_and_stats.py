#!/usr/bin/env python3
from pathlib import Path
import re
import shutil
from datetime import datetime
import sys

ROOT = Path.cwd()

FILES = {
    "stats": ROOT / "pages/api/affiliate/stats.ts",
    "checkout": ROOT / "pages/api/stripe/create-checkout-session.ts",
}

def backup(path: Path):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = path.with_suffix(path.suffix + f".bak_{ts}")
    shutil.copy2(path, bak)
    print(f"[backup] {path} -> {bak}")

def must_find(text: str, pattern: str, label: str):
    if not re.search(pattern, text, re.DOTALL):
        print(f"[ERROR] Could not find {label}")
        sys.exit(1)

def patch_stats():
    path = FILES["stats"]
    text = path.read_text(encoding="utf-8")
    old = '''const signups =
    typeof affiliate.totalReferrals === "number"
      ? affiliate.totalReferrals
      : referrals.length;'''
    new = '''const signups = Math.max(
    Number(affiliate.totalReferrals || 0),
    referrals.length
  );'''
    if old in text:
        backup(path)
        text = text.replace(old, new, 1)
        path.write_text(text, encoding="utf-8")
        print(f"[patched] {path}")
    else:
        print(f"[skip] stats block already patched or not found: {path}")

def patch_checkout():
    path = FILES["checkout"]
    text = path.read_text(encoding="utf-8")

    must_find(
        text,
        r'checkoutSession = await stripe\\.checkout\\.sessions\\.create\\(\\{',
        "checkout session create block"
    )

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

    if old in text:
        backup(path)
        text = text.replace(old, new, 1)
        path.write_text(text, encoding="utf-8")
        print(f"[patched] {path}")
    else:
        print(f"[skip] checkout metadata block already patched or not found: {path}")

def main():
    patch_stats()
    patch_checkout()
    print("\\n[next]")
    print('1) rg -n "const signups = Math.max|subscription_data:|referralCodeUsed|appliedPromoCode" pages/api/affiliate/stats.ts pages/api/stripe/create-checkout-session.ts')
    print("2) npm run build")
    print("3) test a fresh affiliate signup")
    print("4) verify:")
    print("   - Recent Signups shows the user")
    print("   - Total Referrals increments")
    print("   - First invoice commission still stays $0 unless you choose to change policy")
    print("   - Renewal invoice can still resolve referralCodeUsed from subscription metadata")

if __name__ == "__main__":
    main()
