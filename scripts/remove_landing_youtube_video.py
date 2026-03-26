from pathlib import Path
import re
import shutil
from datetime import datetime
import sys

TARGET = Path("pages/index.tsx")

if not TARGET.exists():
    print("[refuse] pages/index.tsx not found")
    sys.exit(1)

src = TARGET.read_text(encoding="utf-8")

needle = 'src="https://www.youtube.com/embed/'
idx = src.find(needle)
if idx == -1:
    print("[refuse] Could not find YouTube embed src in pages/index.tsx")
    sys.exit(1)

# Find the nearest enclosing <div ...> before the iframe embed
start = src.rfind("<div", 0, idx)
if start == -1:
    print("[refuse] Could not find opening <div before YouTube embed")
    sys.exit(1)

# Walk forward from that div and remove the full balanced div block
i = start
depth = 0
opened = False
while i < len(src):
    if src.startswith("<div", i):
        depth += 1
        opened = True
        i += 4
        continue
    if src.startswith("</div>", i):
        depth -= 1
        i += 6
        if opened and depth == 0:
            end = i
            break
        continue
    i += 1
else:
    print("[refuse] Could not find balanced closing </div> for YouTube block")
    sys.exit(1)

block = src[start:end]

if "youtube.com/embed" not in block:
    print("[refuse] Balanced block did not contain youtube embed as expected")
    sys.exit(1)

ts = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = TARGET.with_suffix(TARGET.suffix + f".bak_{ts}")
shutil.copy2(TARGET, backup)
print(f"[patch] Backup created: {backup}")

new_src = src[:start] + src[end:]

# Collapse excessive blank lines created by removal
new_src = re.sub(r"\n{3,}", "\n\n", new_src)

TARGET.write_text(new_src, encoding="utf-8")
print("[patch] Removed landing-page YouTube video block from pages/index.tsx")
