from pathlib import Path
import re
import sys

files = {
    "panel": Path("components/DripCampaignsPanel.tsx"),
    "api_index": Path("pages/api/drips/index.ts"),
    "runner": Path("pages/api/internal/run-drips.ts"),
}

for key, path in files.items():
    if not path.exists():
        print(f"[refuse] Missing file: {path}")
        sys.exit(1)

panel = files["panel"].read_text(encoding="utf-8")
api_index = files["api_index"].read_text(encoding="utf-8")
runner = files["runner"].read_text(encoding="utf-8")

# --------------------------------------------------
# 1) UI save paths: stop re-adding opt-out to every step on save
#    Keep the builder default alone. Users can still manually remove later.
# --------------------------------------------------
panel_replacements = [
    (
        """    // Enforce opt-out on every message (same rule as builder)
    const optOut = " Reply STOP to opt out.";
    const normalized = steps.map((s) => {
      const day = String(s.day || "immediately");
      const textRaw = String(s.text || "").trim();
      const text = textRaw.endsWith(optOut) ? textRaw : `${textRaw}${optOut}`;
      return { day, text };
    });""",
        """    // Preserve edited text as written. First-touch opt-out is enforced at send time.
    const normalized = steps.map((s) => {
      const day = String(s.day || "immediately");
      const text = String(s.text || "").trim();
      return { day, text };
    });"""
    ),
    (
        """    // Enforce opt-out on every message (same rule as builder)
    const optOut = " Reply STOP to opt out.";
    const normalized = steps.map((s) => {
      const day = String(s.day || "immediately");
      const textRaw = String(s.text || "").trim();
      const text = textRaw.endsWith(optOut) ? textRaw : `${textRaw}${optOut}`;
      return { day, text };
    });""",
        """    // Preserve edited text as written. First-touch opt-out is enforced at send time.
    const normalized = steps.map((s) => {
      const day = String(s.day || "immediately");
      const text = String(s.text || "").trim();
      return { day, text };
    });"""
    ),
    (
        """    // Enforce opt-out on every message
    const optOut = " Reply STOP to opt out.";
    const normalized = steps.map((s: any) => {
      const day = String(s.day || "immediately");
      const textRaw = String(s.text || "").trim();
      const text = textRaw.endsWith(optOut) ? textRaw : `${textRaw}${optOut}`;
      return { day, text };
    });""",
        """    // Preserve edited text as written. First-touch opt-out is enforced at send time.
    const normalized = steps.map((s: any) => {
      const day = String(s.day || "immediately");
      const text = String(s.text || "").trim();
      return { day, text };
    });"""
    ),
]

for old, new in panel_replacements:
    if old in panel:
        panel = panel.replace(old, new, 1)

# --------------------------------------------------
# 2) API create path: stop force-appending opt-out on create
# --------------------------------------------------
old_api = """      const optOut = " Reply STOP to opt out.";
      const steps = (req.body.steps || []).map(
        (step: { text: string; day: string }) => {
          const enforcedText = step.text.trim().endsWith(optOut)
            ? step.text.trim()
            : `${step.text.trim()}${optOut}`;
          return { ...step, text: enforcedText };
        },
      );"""

new_api = """      const steps = (req.body.steps || []).map(
        (step: { text: string; day: string }) => ({
          ...step,
          text: String(step?.text || "").trim(),
        }),
      );"""

if old_api not in api_index:
    print("[refuse] Could not find create-path opt-out enforcement block in pages/api/drips/index.ts")
    sys.exit(1)

api_index = api_index.replace(old_api, new_api, 1)

# --------------------------------------------------
# 3) Drip runner: enforce opt-out ONLY on first touch (idx === 0)
# --------------------------------------------------
old_runner = """        const finalBody = ensureOptOut(rendered);"""
new_runner = """        const finalBody = idx === 0 ? ensureOptOut(rendered) : String(rendered || "").trim();"""

if old_runner not in runner:
    print("[refuse] Could not find finalBody line in run-drips.ts")
    sys.exit(1)

runner = runner.replace(old_runner, new_runner, 1)

files["panel"].write_text(panel, encoding="utf-8")
files["api_index"].write_text(api_index, encoding="utf-8")
files["runner"].write_text(runner, encoding="utf-8")

print("[patch] Updated drip save/create/send logic:")
print("        - save no longer re-adds opt-out to every step")
print("        - create no longer hard-appends opt-out")
print("        - first-touch drip sends still enforce opt-out")
