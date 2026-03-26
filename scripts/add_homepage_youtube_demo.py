#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from datetime import datetime
import shutil
import sys

TARGET = Path("pages/index.tsx")

ANCHOR = "{/* Pricing Section */}"
SENTINEL = "data-cove-home-video"
YOUTUBE_EMBED = "https://www.youtube.com/embed/yLgH-4AEn0Q?rel=0&modestbranding=1"

INSERT_BLOCK = f"""

        {{/* --- Demo Video (YouTube) --- */}}
        <section className="py-14 px-6" {SENTINEL!s}="1">
          <div className="max-w-6xl mx-auto">
            <div className="rounded-3xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] p-6 md:p-8">
              <div className="text-center mb-6">
                <h2 className="text-2xl sm:text-3xl font-semibold text-white">Watch the demo</h2>
                <p className="text-white/70 mt-2">See CoveCRM in action in under 2 minutes.</p>
              </div>

              <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#020617]" style={{ paddingTop: "56.25%" }}>
                <iframe
                  className="absolute inset-0 h-full w-full"
                  src="{YOUTUBE_EMBED}"
                  title="CoveCRM Demo"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            </div>
          </div>
        </section>

"""

def backup(path: Path) -> None:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    b = path.with_suffix(path.suffix + f".bak_{ts}")
    shutil.copy2(path, b)
    print("[patch] Backup:", b)

def main() -> None:
    if not TARGET.exists():
        print(f"[patch] ERROR: missing {TARGET}", file=sys.stderr)
        sys.exit(1)

    data = TARGET.read_text(encoding="utf-8")

    if SENTINEL in data:
        print("[patch] Already present (sentinel found). No changes.")
        return

    idx = data.find(ANCHOR)
    if idx == -1:
        print(f"[patch] ERROR: anchor not found: {ANCHOR}", file=sys.stderr)
        sys.exit(1)

    # Insert block immediately before the anchor comment
    new_data = data[:idx] + INSERT_BLOCK + data[idx:]

    backup(TARGET)
    TARGET.write_text(new_data, encoding="utf-8")
    print("[patch] Inserted YouTube demo section before Pricing Section.")

if __name__ == "__main__":
    main()
