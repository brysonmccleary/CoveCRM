from __future__ import annotations

import re
from pathlib import Path

PATH = Path("pages/index.tsx")

OLD_NOTE_RE = re.compile(
    r"""<p className="text-xs text-slate-400 mt-3 max-w-4xl mx-auto leading-relaxed">\s*
\s*Note: Many CRMs now offer AI features.*?\s*
\s*</p>""",
    re.DOTALL,
)

NEW_NOTE = """<p className="text-xs text-slate-400 mt-3 max-w-4xl mx-auto leading-relaxed">
                Note: Many CRMs now offer AI-assisted features (for example: AI writing/coaching tools, workflow helpers, or call assistance). CoveCRM’s AI is purpose-built for life insurance outbound — built directly into the calling + texting workflow (call overviews + automated follow-up), not just a generic add-on.
              </p>"""

def main() -> None:
    if not PATH.exists():
        raise SystemExit(f"Missing file: {PATH}")

    s = PATH.read_text(encoding="utf-8")
    orig = s

    # 1) Replace the AI note paragraph with accurate, non-accusatory wording
    if OLD_NOTE_RE.search(s):
        s = OLD_NOTE_RE.sub(NEW_NOTE, s, count=1)
    else:
        # If the paragraph text changed slightly, do a fallback anchored insert right after the "Built specifically..." paragraph
        anchor = "Built specifically for high-volume outbound life insurance sales — not adapted from marketing-first systems."
        idx = s.find(anchor)
        if idx == -1:
            raise SystemExit("Could not find anchor line for AI note insertion.")
        insert_at = s.find("</p>", idx)
        if insert_at == -1:
            raise SystemExit("Could not find closing </p> after anchor.")
        insert_at = insert_at + len("</p>")
        s = s[:insert_at] + "\n" + "              " + NEW_NOTE + s[insert_at:]

    # 2) Ensure your benefit bullet stays the accurate wording you chose
    s = s.replace("Native AI voice assistance", "AI built into calling + call summaries")

    # 3) Add/replace a short comparison disclaimer line under the comparison header (safe + accurate)
    # We look for the section title "COMPARISON (INSURANCE USE CASE)" and place disclaimer shortly below it.
    if "COMPARISON (INSURANCE USE CASE)" in s:
        # If disclaimer already exists, update it.
        s = re.sub(
            r"""(<div className="text-xs text-slate-400[^"]*">)\s*Competitor features.*?(</div>)""",
            r"""\1Competitor capabilities can vary by plan, add-ons, and integrations. We mark “Native/Included” only when it’s available directly in the core product experience; otherwise it’s shown as “Add-on / Integration.”\2""",
            s,
            flags=re.DOTALL,
        )

        # If no disclaimer was present, insert one after the comparison heading block.
        if "Competitor capabilities can vary by plan" not in s:
            # Insert after the line that contains the comparison title (keep formatting minimal and consistent)
            s = s.replace(
                "COMPARISON (INSURANCE USE CASE)",
                "COMPARISON (INSURANCE USE CASE)"
            )
            # Find the first occurrence of the heading text node and inject a disclaimer div nearby.
            # We'll anchor on the heading label rendering if it exists as plain text in JSX.
            s = re.sub(
                r"""(COMPARISON \(INSURANCE USE CASE\).*?\n)""",
                r"""\1
              <div className="text-xs text-slate-400 mt-2 leading-relaxed">
                Competitor capabilities can vary by plan, add-ons, and integrations. We mark “Native/Included” only when it’s available directly in the core product experience; otherwise it’s shown as “Add-on / Integration.”
              </div>
""",
                s,
                count=1,
                flags=re.DOTALL,
            )

    if s == orig:
        raise SystemExit("No changes made (patch did not apply).")

    PATH.write_text(s, encoding="utf-8")
    print("OK: landing page AI competitor copy updated safely.")

if __name__ == "__main__":
    main()
