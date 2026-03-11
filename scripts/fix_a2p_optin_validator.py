from pathlib import Path
import sys

path = Path("components/A2PVerificationForm.tsx")
src = path.read_text(encoding="utf-8")

old = """      } else if (!/consent/i.test(od) || !/(by clicking|by entering)/i.test(od)) {
        newErrors.optInDetails =
          'Opt-in description must clearly state that the user gives consent by clicking/entering their information (e.g., "By entering your information and clicking this button, you consent to receive calls/texts...").';
      }"""

new = """      } else if (
        !/consent/i.test(od) ||
        !/(by clicking|by entering|by submitting|by checking the box|by providing)/i.test(od)
      ) {
        newErrors.optInDetails =
          'Opt-in description must clearly state how the user gives consent (for example: by clicking, entering their information, submitting the form, checking the box, or providing their phone number).';
      }"""

if old not in src:
    print("[refuse] Exact target block not found")
    sys.exit(1)

src = src.replace(old, new, 1)
path.write_text(src, encoding="utf-8")
print("[patch] Updated opt-in validator in", path)
