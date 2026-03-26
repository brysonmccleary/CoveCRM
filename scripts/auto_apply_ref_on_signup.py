from __future__ import annotations
from pathlib import Path
from datetime import datetime
import shutil, sys, re

def backup(p: Path):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    b = p.with_suffix(p.suffix + f".bak_{ts}")
    shutil.copy2(p, b)
    print(f"[backup] {p} -> {b}")

p = Path("pages/signup.tsx")
text = p.read_text(encoding="utf-8")

needles = [
    "const router = useRouter();",
    "const [promoCode, setPromoCode]",
    "const handleCodeBlur = async () => {",
    'axios.post("/api/apply-code"',
]
for n in needles:
    if n not in text:
        print(f"[ABORT] Missing anchor in signup.tsx: {n}")
        sys.exit(1)

if "AUTO_REF_APPLY_EFFECT" in text:
    print("[skip] AUTO_REF_APPLY_EFFECT already present")
    sys.exit(0)

backup(p)

# 1) Replace the small existing effect that only reads router.query.code
# Current block:
# useEffect(() => { if (router.query.code ... ) setPromoCode(...) }, [router.query.code]);
pattern = re.compile(r"useEffect\(\(\) => \{\s*if \(router\.query\.code .*?\}\s*\}, \[router\.query\.code\]\);", re.S)

m = pattern.search(text)
if not m:
    print("[ABORT] Could not locate existing router.query.code useEffect block.")
    sys.exit(1)

replacement = """useEffect(() => {
    // AUTO_REF_APPLY_EFFECT
    // ✅ Accept affiliate links in either format:
    //   /signup?ref=CODE   (new affiliate link)
    //   /signup?code=CODE  (legacy)
    const qpRef = router.query.ref;
    const qpCode = router.query.code;

    const fromRef = typeof qpRef === "string" ? qpRef : Array.isArray(qpRef) ? qpRef[0] : "";
    const fromCode = typeof qpCode === "string" ? qpCode : Array.isArray(qpCode) ? qpCode[0] : "";

    const incoming = (fromRef || fromCode || "").trim();
    if (!incoming) return;

    setPromoCode(incoming);

    // Persist so it survives redirects / refreshes
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("affiliate_code", incoming);
        document.cookie = `affiliate_code=${encodeURIComponent(incoming)}; path=/; max-age=2592000`; // 30d
      }
    } catch {}
  }, [router.query.ref, router.query.code]);"""

text = text[:m.start()] + replacement + text[m.end():]

# 2) Add a second effect: whenever promoCode is set from ref/code, auto-apply it (no blur needed)
insert_anchor = "  const handleCodeBlur = async () => {"
idx = text.find(insert_anchor)
if idx == -1:
    print("[ABORT] Could not find handleCodeBlur anchor for insertion.")
    sys.exit(1)

auto_apply = """  useEffect(() => {
    // AUTO_REF_APPLY_RUN
    // If we arrived with a code already present, auto-apply it once.
    const run = async () => {
      const code = (promoCode || "").trim();
      if (!code) return;
      if (discountApplied) return; // already applied
      if (checkingCode) return; // already checking

      // Only auto-run when code came from query/cookie/storage.
      // If user is typing, they can still blur to apply.
      const qpRef = router.query.ref;
      const qpCode = router.query.code;
      const fromQuery =
        (typeof qpRef === "string" && qpRef.trim() === code) ||
        (typeof qpCode === "string" && qpCode.trim() === code);

      let fromPersist = false;
      try {
        const stored =
          typeof window !== "undefined" ? (localStorage.getItem("affiliate_code") || "") : "";
        const cookie =
          typeof document !== "undefined"
            ? (document.cookie.match(/(?:^|; )affiliate_code=([^;]+)/)?.[1] || "")
            : "";
        fromPersist =
          decodeURIComponent(stored || "").trim() == code ||
          decodeURIComponent(cookie || "").trim() == code;
      } catch {}

      if (!fromQuery and not fromPersist):
        return
    };
  }, []);
"""

# The above is Python-invalid as-is; build correct TS effect string in python:
auto_apply_ts = """  useEffect(() => {
    // AUTO_REF_APPLY_RUN
    // If we arrived with a code already present, auto-apply it once (no blur needed).
    const code = (promoCode || "").trim();
    if (!code) return;
    if (discountApplied) return;
    if (checkingCode) return;

    const qpRef = router.query.ref;
    const qpCode = router.query.code;

    const fromQuery =
      (typeof qpRef === "string" && qpRef.trim() === code) ||
      (typeof qpCode === "string" && qpCode.trim() === code);

    let fromPersist = false;
    try {
      const stored =
        typeof window !== "undefined" ? localStorage.getItem("affiliate_code") || "" : "";
      const cookie =
        typeof document !== "undefined"
          ? document.cookie.match(/(?:^|; )affiliate_code=([^;]+)/)?.[1] || ""
          : "";
      fromPersist =
        decodeURIComponent(stored || "").trim() === code ||
        decodeURIComponent(cookie || "").trim() === code;
    } catch {}

    if (!fromQuery && !fromPersist) return;

    // Fire the same logic as blur would, but silently (no extra toast spam).
    (async () => {
      setCheckingCode(true);
      try {
        const res = await axios.post("/api/apply-code", { code });
        const { price, ownerEmail } = res.data || {};
        if (typeof price === "number") setFinalPrice(price);
        setAffiliateEmail(ownerEmail || "");
        setDiscountApplied(true);
      } catch {
        setDiscountApplied(false);
        setFinalPrice(basePrice);
        setAffiliateEmail("");
      } finally {
        setCheckingCode(false);
      }
    })();
  }, [promoCode, router.query.ref, router.query.code]);\n\n"""

text = text[:idx] + auto_apply_ts + text[idx:]

p.write_text(text, encoding="utf-8")
print("[ok] Patched", p)
print("Next: git diff --", p)
