from pathlib import Path
import sys

targets = [
    Path("pages/api/registerA2P.ts"),
    Path("pages/api/a2p/start.ts"),
]

for path in targets:
    src = path.read_text(encoding="utf-8")

    if str(path).endswith("registerA2P.ts"):
        old = "  const body = (req.body || {}) as BodyIn;\n  const errors: ValidationErrors = {};\n"
        new = """  const body = (req.body || {}) as BodyIn;
  console.log("[registerA2P] incoming body keys:", Object.keys(body || {}));
  console.log("[registerA2P] incoming body:", JSON.stringify(body, null, 2));
  const errors: ValidationErrors = {};
"""
    else:
        old = 'function required<T>(v: T, name: string): T {\n  if (!v) throw new Error(`Missing required field: ${name}`);\n  return v;\n}\n'
        new = """function required<T>(v: T, name: string): T {
  if (!v) {
    console.error("[A2P start] Missing required field:", name);
    throw new Error(`Missing required field: ${name}`);
  }
  return v;
}
"""

    if old not in src:
        print(f"[refuse] anchor not found in {path}")
        sys.exit(1)

    src = src.replace(old, new, 1)
    path.write_text(src, encoding="utf-8")
    print(f"[patch] updated {path}")
