from pathlib import Path
from datetime import datetime
import shutil
import re
import sys

optin_path = Path("pages/sms/optin/[userId].tsx")
privacy_path = Path("pages/sms/optin-privacy/[userId].tsx")

for p in [optin_path, privacy_path]:
    if not p.exists():
        print(f"[refuse] Missing file: {p}")
        sys.exit(1)

ts = datetime.now().strftime("%Y%m%d_%H%M%S")
for p in [optin_path, privacy_path]:
    backup = p.with_suffix(p.suffix + f".bak_{ts}")
    shutil.copy2(p, backup)
    print(f"[backup] {backup}")

optin_src = optin_path.read_text(encoding="utf-8")
privacy_src = privacy_path.read_text(encoding="utf-8")

# ---- opt-in page ----

optin_src = optin_src.replace(
    'type Props = {\n  businessName: string;\n  agentName: string;\n  email: string;\n  phone: string;\n};',
    'type Props = {\n  businessName: string;\n  agentName: string;\n  email: string;\n  phone: string;\n  userId: string;\n};'
)

optin_src = optin_src.replace(
    '  const { businessName, agentName, email, phone } = props;',
    '  const { businessName, agentName, email, phone, userId } = props;'
)

optin_src = optin_src.replace(
    '  const [marketingConsent, setMarketingConsent] = useState(false);\n',
    ''
)

optin_src = re.sub(
    r'const onSubmit = \(e: React\.FormEvent\) => \{\s*e\.preventDefault\(\);\s*if \(!consent\) return;\s*setSubmitted\(true\)\s*\};',
    'const onSubmit = (e: React.FormEvent) => {\n    e.preventDefault();\n    setSubmitted(true);\n  };',
    optin_src,
    flags=re.S
)

optin_src = optin_src.replace(
    '<h1 className="text-3xl font-bold">SMS Opt-In</h1>',
    '<h1 className="text-3xl font-bold">SMS Communication Preferences</h1>'
)

optin_src = optin_src.replace(
    'Use this page to confirm consent to receive text messages from your licensed agent using CoveCRM.',
    'This page is used by existing customers to confirm their communication preferences for text messages related to their current policy, account servicing, and policy updates.'
)

optin_src = optin_src.replace(
    '<span className="font-semibold text-slate-200">Sender:</span>{" "}',
    '<span className="font-semibold text-slate-200">Business:</span>{" "}'
)

optin_src = optin_src.replace(
    '<div>\n              <span className="font-semibold text-slate-200">Contact:</span>{" "}\n              <span className="text-slate-100">{contactLine}</span>\n            </div>',
    '<div>\n              <span className="font-semibold text-slate-200">Representative:</span>{" "}\n              <span className="text-slate-100">{agentName}</span>\n            </div>\n            <div>\n              <span className="font-semibold text-slate-200">Contact:</span>{" "}\n              <span className="text-slate-100">{contactLine}</span>\n            </div>\n            <div className="text-xs text-slate-400">\n              SMS consent is optional. You may submit this form without agreeing to receive SMS messages.\n            </div>'
)

optin_src = optin_src.replace(
    'By checking this box, you agree to receive SMS messages from{" "}\n                  <span className="font-semibold">{agentName}</span> using CoveCRM related to your existing policy,\n                  policy updates, account servicing, and retention-related communications. Message frequency varies.\n                  Msg &amp; data rates may apply. Reply STOP to cancel. Reply HELP for help. Consent is not a condition\n                  of purchase.',
    'By checking this box, you agree to receive SMS messages from{" "}\n                  <span className="font-semibold">{businessName}</span> regarding your existing policy, policy updates,\n                  account servicing, and retention-related communications. Message frequency varies. Msg &amp; data rates\n                  may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase.'
)

optin_src = optin_src.replace(
    'href={`/sms/optin-terms/${encodeURIComponent(String((props as any).userId || ""))}`}>Opt-in Terms</a>',
    'href={`/sms/optin-terms/${encodeURIComponent(userId)}`}>Opt-in Terms</a>'
)

optin_src = optin_src.replace(
    'href={`/sms/optin-privacy/${encodeURIComponent(String((props as any).userId || ""))}`}>Opt-in Privacy</a>',
    'href={`/sms/optin-privacy/${encodeURIComponent(userId)}`}>Opt-in Privacy</a>'
)

optin_src = optin_src.replace(
    'Submit Opt-In',
    'Submit Information'
)

optin_src = optin_src.replace(
    'This page is provided by CoveCRM to support compliant SMS opt-in documentation for A2P 10DLC review.',
    'This page is provided by CoveCRM to support SMS communication preference documentation for existing customer communications.'
)

# add optional-consent helper above checkbox block if not already there
if 'Checking the box below is optional and only applies if you want to receive SMS messages from this business.' not in optin_src:
    optin_src = optin_src.replace(
        '<div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">',
        '<div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">\n              <div className="text-xs text-slate-400 mb-3">\n                Checking the box below is optional and only applies if you want to receive SMS messages from this business.\n              </div>',
        1
    )

# ---- privacy page ----

privacy_src = privacy_src.replace(
    'This privacy notice explains how information is handled when you opt in to receive SMS messages from your licensed agent using CoveCRM.',
    'This privacy notice explains how information is handled when you submit this form and, if you choose, opt in to receive SMS messages related to your existing policy, account servicing, and policy updates.'
)

privacy_src = re.sub(
    r'<h2 className="text-xl font-semibold mt-6 mb-2">3\. Sharing</h2>\s*<p className="text-slate-200 mb-4">.*?</p>',
    '''<h2 className="text-xl font-semibold mt-6 mb-2">3. Sharing</h2>
        <p className="text-slate-200 mb-4">
          We do not sell or share mobile or personal data with third parties, affiliates, or partners for marketing or promotional purposes.
          We only share data with third parties when it is strictly necessary to deliver our service and only under binding agreements that
          ensure confidentiality. Under no circumstances will mobile data be shared or sold for advertising or promotional use.
        </p>
        <p className="text-slate-200 mb-4">
          Data may be processed by service providers used to deliver SMS services and to host CoveCRM. These providers receive only the
          information necessary to perform their services and are required to protect the data.
        </p>''',
    privacy_src,
    flags=re.S
)

optin_path.write_text(optin_src, encoding="utf-8")
privacy_path.write_text(privacy_src, encoding="utf-8")
print("[ok] Forced patch applied successfully.")
