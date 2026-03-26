#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime
import shutil
import sys

PATH = Path("pages/api/affiliate/stats.ts")

OLD = '''  // Referrals list: prefer Affiliate.referrals (populated by webhook on first invoice),
  // fallback to Users referred by this code for legacy scenarios.
  let referrals =
    Array.isArray(affiliate.referrals) && affiliate.referrals.length
      ? affiliate.referrals
          .slice()
          .sort((a: any, b: any) => +new Date(b.joinedAt || b.date || 0) - +new Date(a.joinedAt || a.date || 0))
          .slice(0, 20)
          .map((r: any) => ({
            name: r.name || "Unnamed",
            email: r.email,
            joinedAt: r.joinedAt || r.date || new Date(),
          }))
      : [];

  if (referrals.length === 0) {
    // Fallback for older signups that don't exist in Affiliate.referrals
    const referredUsers = await User.find({
      $or: [
        { referredBy: U(affiliate.promoCode) },
        { referredByCode: U(affiliate.promoCode) },
      ],
    })
      .select("name email createdAt")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    referrals = referredUsers.map((r) => ({
      name: r.name || "Unnamed",
      email: r.email,
      joinedAt: r.createdAt || new Date(),
    }));
  }

  // Counts / totals (source of truth = Affiliate doc)
  const signups = Math.max(
    Number(affiliate.totalReferrals || 0),
    referrals.length
  );'''

NEW = '''  // Referrals list: only show ACTIVE paid referrals.
  // Source of truth = Affiliate.referrals written by Stripe webhook after paid invoice.
  const affiliateReferralRows = Array.isArray(affiliate.referrals)
    ? affiliate.referrals
        .slice()
        .sort(
          (a: any, b: any) =>
            +new Date(b.joinedAt || b.date || 0) - +new Date(a.joinedAt || a.date || 0)
        )
    : [];

  const affiliateReferralEmails = affiliateReferralRows
    .map((r: any) => String(r?.email || "").trim().toLowerCase())
    .filter(Boolean);

  let activeUsersByEmail = new Map<string, any>();
  if (affiliateReferralEmails.length > 0) {
    const activeUsers = await User.find({
      email: { $in: affiliateReferralEmails },
      subscriptionStatus: "active",
    })
      .select("name email createdAt subscriptionStatus")
      .lean();

    activeUsersByEmail = new Map(
      activeUsers.map((u: any) => [String(u.email || "").trim().toLowerCase(), u])
    );
  }

  const referrals = affiliateReferralRows
    .filter((r: any) => activeUsersByEmail.has(String(r?.email || "").trim().toLowerCase()))
    .slice(0, 20)
    .map((r: any) => {
      const email = String(r?.email || "").trim().toLowerCase();
      const activeUser = activeUsersByEmail.get(email);
      return {
        name: activeUser?.name || r?.name || "Unnamed",
        email,
        joinedAt: r?.joinedAt || r?.date || activeUser?.createdAt || new Date(),
      };
    });

  // Counts / totals = active paid referrals only
  const signups = referrals.length;'''

def backup(path: Path):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = path.with_suffix(path.suffix + f".bak_{ts}")
    shutil.copy2(path, bak)
    print(f"[backup] {path} -> {bak}")

def main():
    text = PATH.read_text(encoding="utf-8")

    if "const signups = referrals.length;" in text and "only show ACTIVE paid referrals" in text:
        print("[skip] active paid-only stats logic already present")
        return

    if OLD not in text:
        print("[error] target block not found exactly")
        sys.exit(1)

    backup(PATH)
    text = text.replace(OLD, NEW, 1)
    PATH.write_text(text, encoding="utf-8")
    print(f"[patched] {PATH}")

if __name__ == "__main__":
    main()
