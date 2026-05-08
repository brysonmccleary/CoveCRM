const PAGE_NAMES: Record<string, string> = {
  veteran: "Veteran Benefits Center",
  trucker: "Trucker Life Coverage",
  final_expense: "Final Expense Planning",
  mortgage_protection: "Mortgage Protection Center",
  iul: "IUL Education Center",
};

const PAGE_ACCENTS: Record<string, string> = {
  veteran: "#1a2744",
  trucker: "#00bcd4",
  final_expense: "#d4a017",
  mortgage_protection: "#b91c1c",
  iul: "#d4a017",
};

const MORTGAGE_BACKGROUND =
  "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80";

const MORTGAGE_PHOTOS = [
  "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80",
  "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&q=80",
  "https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&q=80",
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80",
];

function cleanText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanText).filter(Boolean).slice(0, 4)
    : [];
}

function getOverlay(draft: any) {
  const overlay = draft?.overlayData || draft?.landingPageConfig || {};
  return {
    headline: cleanText(overlay.headline || draft?.headline),
    subheadline: cleanText(overlay.subheadline),
    buttonLabels: cleanList(overlay.buttonLabels || draft?.buttonLabels),
    benefitBullets: cleanList(overlay.benefitBullets || draft?.bulletPoints),
    ctaStrip: cleanText(overlay.ctaStrip),
  };
}

function isAgeTapCta(value: string): boolean {
  const text = value.toLowerCase();
  return text.includes("tap") && text.includes("age");
}

function BottomBar({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 44,
        background: color,
        color: "#ffffff",
        fontSize: 14,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {label}
    </div>
  );
}

function CheckList({
  bullets,
  color = "#ffffff",
  checkColor = "#22c55e",
  padding = "0 20px",
}: {
  bullets: string[];
  color?: string;
  checkColor?: string;
  padding?: string;
}) {
  if (!bullets.length) return null;

  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding,
        color,
        fontSize: 12,
        lineHeight: 1.35,
      }}
    >
      {bullets.slice(0, 3).map((bullet, index) => (
        <li
          key={`${bullet}-${index}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginBottom: 5,
            textAlign: "left",
          }}
        >
          <span style={{ color: checkColor, fontWeight: 900 }}>✓</span>
          <span>{bullet}</span>
        </li>
      ))}
    </ul>
  );
}

function pickTemplate(fingerprint: string, leadType: string): number {
  let hash = 0;
  const str = String(fingerprint || Math.random().toString(36));
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  const TEMPLATE_COUNTS: Record<string, number> = {
    veteran: 6,
    trucker: 4,
    final_expense: 4,
    mortgage_protection: 4,
    iul: 3,
  };
  const count = TEMPLATE_COUNTS[leadType] || 4;
  return Math.abs(hash) % count;
}

function VeteranCreative({
  overlay,
  templateIndex,
}: {
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  if (templateIndex === 0) {
    const ctaText = isAgeTapCta(overlay.ctaStrip)
      ? overlay.ctaStrip.replace(/\s*→\s*$/, "").toUpperCase()
      : "TAP YOUR AGE TO SEE IF YOU QUALIFY";

    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#f5f0e8", color: "#1a2744" }}>
        <div style={{ paddingTop: 20 }}>
          <div style={{ color: "#1a2744", fontSize: 32, fontWeight: 900, textAlign: "center", letterSpacing: 2, textTransform: "uppercase", padding: "0 16px", lineHeight: 1.05 }}>
            {overlay.headline}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#8b1a1a", margin: "12px auto", width: "80%" }}>
            <div style={{ flex: 1, borderTop: "1px solid #8b1a1a" }} />
            <div style={{ fontSize: 16, lineHeight: 1 }}>★</div>
            <div style={{ flex: 1, borderTop: "1px solid #8b1a1a" }} />
          </div>
          <div style={{ color: "#1a2744", fontSize: 13, fontWeight: 700, textAlign: "center", padding: "0 16px", lineHeight: 1.35 }}>
            {overlay.subheadline}
          </div>
          <div style={{ height: 16 }} />
          <div style={{ color: "#1a2744", fontSize: 11, fontWeight: 700, textAlign: "center", letterSpacing: 1, padding: "0 16px" }}>
            {ctaText}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", margin: "12px 16px" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#1a2744", color: "#ffffff", borderRadius: 50, padding: "10px 18px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#c0392b" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 1) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0a0f1a" }}>
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ color: "#c9a84c", fontSize: 11, fontWeight: 700, textAlign: "center", letterSpacing: 3, marginBottom: 8 }}>
            •BUILT FOR VETERANS•
          </div>
          <div style={{ borderTop: "1px solid #c9a84c", marginBottom: 12 }} />
          <div style={{ color: "#ffffff", fontSize: 28, fontWeight: 900, textAlign: "center", lineHeight: 1.05, letterSpacing: 1, textTransform: "uppercase" }}>
            {overlay.headline}
          </div>
          <div style={{ borderBottom: "1px solid #c9a84c", margin: "12px 0" }} />
          <div style={{ color: "#c9a84c", fontSize: 13, fontWeight: 700, textAlign: "center", lineHeight: 1.35 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "16px 0" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#1d4ed8", color: "#ffffff", borderRadius: 6, padding: "10px 18px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#1d4ed8" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 2) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(160deg, #1a0a0a 0%, #0a0a2a 50%, #1a0a0a 100%)" }}>
        <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, transparent, transparent 18px, rgba(180,0,0,0.08) 18px, rgba(180,0,0,0.08) 20px), repeating-linear-gradient(90deg, transparent, transparent 18px, rgba(0,0,180,0.06) 18px, rgba(0,0,180,0.06) 20px)" }} />
        <div style={{ position: "relative", padding: "22px 16px 0" }}>
          <div style={{ color: "#FFD700", fontSize: 30, fontWeight: 900, textAlign: "center", textTransform: "uppercase", lineHeight: 1.05, letterSpacing: 1, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#ffffff", fontSize: 12, fontWeight: 700, textAlign: "center", margin: "10px 0", lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ color: "#FFD700", fontSize: 11, fontWeight: 800, textAlign: "center", letterSpacing: 2, margin: "8px 0" }}>
            TAP YOUR AGE TO VIEW AVAILABLE BENEFITS
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "10px 0" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "2px solid #FFD700", background: "rgba(0,0,0,0.5)", color: "#FFD700", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#c0392b" label="Apply now →" />
      </div>
    );
  }

  if (templateIndex === 3) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0d1117" }}>
        <div style={{ padding: "18px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#60a5fa", fontSize: 11, fontWeight: 700, letterSpacing: 3, marginBottom: 10 }}>
            VETERANS LIFE INSURANCE
          </div>
          <div style={{ color: "#ffffff", fontSize: 26, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 6 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 52, fontWeight: 900, lineHeight: 1, margin: "10px 0 4px" }}>
            $50,000
          </div>
          <div style={{ color: "#60a5fa", fontSize: 12, marginBottom: 14 }}>
            Immediate Coverage Available
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#1e3a5f", border: "1px solid #3b82f6", color: "#ffffff", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#1d4ed8" label="Check My Options →" />
      </div>
    );
  }

  if (templateIndex === 4) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#f8f8f8" }}>
        <div style={{ background: "#c0392b", padding: "18px 20px 14px", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 28, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1, lineHeight: 1.1 }}>
            {overlay.headline}
          </div>
        </div>
        <div style={{ padding: "14px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#1a2744", fontSize: 13, fontWeight: 700, marginBottom: 12, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ color: "#c0392b", fontSize: 11, fontWeight: 800, letterSpacing: 1, marginBottom: 10 }}>
            TAP YOUR AGE TO SEE IF YOU QUALIFY
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#1a2744", color: "#ffffff", borderRadius: 6, padding: "10px 16px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          <CheckList bullets={overlay.benefitBullets} color="#1a2744" checkColor="#c0392b" padding="12px 0 0" />
        </div>
        <BottomBar color="#c0392b" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 5) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(135deg, #0a0f1a 0%, #1a0a0a 50%, #0a0a1a 100%)" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, background: "linear-gradient(90deg, #c0392b 33%, #ffffff 33%, #ffffff 66%, #1d4ed8 66%)" }} />
        <div style={{ padding: "22px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 26, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 8 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#93c5fd", fontSize: 12, marginBottom: 14, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "1.5px solid #ffffff", background: "transparent", color: "#ffffff", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          <CheckList bullets={overlay.benefitBullets} color="#e2e8f0" checkColor="#22c55e" padding="0 10px" />
        </div>
        <BottomBar color="#c0392b" label="See If I Qualify →" />
      </div>
    );
  }

  return null;
}

function TruckerCreative({
  overlay,
  templateIndex,
}: {
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  if (templateIndex === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0a0a0a" }}>
        <div style={{ minHeight: "100%", background: "linear-gradient(180deg, #0a0a0a 0%, #0d1a0d 100%)", boxShadow: "inset 0 0 58px rgba(0, 229, 255, 0.16), inset 0 -80px 95px rgba(255, 0, 170, 0.08)" }}>
          <div style={{ fontSize: 36, fontWeight: 900, textAlign: "center", color: "transparent", background: "linear-gradient(90deg, #00e5ff 0%, #00bcd4 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", paddingTop: 20, lineHeight: 1 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#ff00aa", fontSize: 13, fontWeight: 700, textAlign: "center", padding: "8px 16px", lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "12px 16px" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "2px solid #00e5ff", background: "transparent", color: "#ffffff", borderRadius: 6, padding: "8px 14px", fontSize: 11, fontWeight: 800, letterSpacing: 1, whiteSpace: "nowrap", boxShadow: "0 0 12px rgba(0, 229, 255, 0.28)" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#1565c0" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 1) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0a0a0a" }}>
        <div style={{ background: "linear-gradient(180deg, #8b0000 0%, #0a0a1a 40%)", padding: "0 0 0" }}>
          <div style={{ background: "linear-gradient(90deg, #c0392b 0%, #8b0000 50%, #1d4ed8 100%)", height: 8 }} />
          <div style={{ padding: "16px 16px 0", textAlign: "center" }}>
            <div style={{ color: "#ffffff", fontSize: 34, fontWeight: 900, textTransform: "uppercase", lineHeight: 1, letterSpacing: 1 }}>
              {overlay.headline}
            </div>
            <div style={{ color: "#f59e0b", fontSize: 12, fontWeight: 700, margin: "8px 0 12px", lineHeight: 1.4 }}>
              {overlay.subheadline}
            </div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ background: "#c0392b", color: "#ffffff", borderRadius: 4, padding: "8px 14px", fontSize: 11, fontWeight: 800, letterSpacing: 1, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
        <BottomBar color="#1565c0" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 2) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(180deg, #0a0a0a 0%, #1a0e00 60%, #2d1600 100%)" }}>
        <div style={{ padding: "20px 16px 0", textAlign: "center" }}>
          <div style={{ color: "#f59e0b", fontSize: 34, fontWeight: 900, textTransform: "uppercase", lineHeight: 1, textShadow: "0 0 20px rgba(245,158,11,0.5)" }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#fcd34d", fontSize: 12, fontWeight: 700, margin: "10px 0 14px", lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "2px solid #f59e0b", background: "rgba(245,158,11,0.1)", color: "#fcd34d", borderRadius: 6, padding: "8px 14px", fontSize: 11, fontWeight: 800, letterSpacing: 1, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          <CheckList bullets={overlay.benefitBullets} color="#fcd34d" checkColor="#f59e0b" padding="0 10px" />
        </div>
        <BottomBar color="#d97706" label="See How It Works →" />
      </div>
    );
  }

  if (templateIndex === 3) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0a1628" }}>
        <div style={{ padding: "20px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#00bcd4", fontSize: 11, fontWeight: 700, letterSpacing: 3, marginBottom: 8 }}>
            CDL DRIVER COVERAGE
          </div>
          <div style={{ color: "#ffffff", fontSize: 28, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 10 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 16, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#00bcd4", color: "#000000", borderRadius: 4, padding: "8px 14px", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          <CheckList bullets={overlay.benefitBullets} color="#e2e8f0" checkColor="#00bcd4" padding="0 10px" />
        </div>
        <BottomBar color="#00838f" label="Check My Options →" />
      </div>
    );
  }

  return null;
}

function FinalExpenseCreative({
  overlay,
  templateIndex,
}: {
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  const showButtons = overlay.buttonLabels.length > 0;

  if (templateIndex === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0f0e0a" }}>
        <div style={{ color: "#d4a017", fontSize: 28, fontWeight: 900, textAlign: "center", padding: "24px 16px 8px", textTransform: "uppercase", lineHeight: 1.1 }}>
          {overlay.headline}
        </div>
        <div style={{ borderTop: "1px solid #d4a017", margin: "0 32px 12px" }} />
        <div style={{ color: "#ffffff", fontSize: 13, textAlign: "center", padding: "0 16px", lineHeight: 1.4 }}>
          {overlay.subheadline}
        </div>
        {showButtons ? (
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "12px 16px" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "1.5px solid #d4a017", background: "transparent", color: "#d4a017", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <CheckList bullets={overlay.benefitBullets} />
          </div>
        )}
        <BottomBar color="#a16207" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 1) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#1a1a2e" }}>
        <div style={{ background: "#16213e", borderBottom: "2px solid #d4a017", padding: "16px 20px", textAlign: "center" }}>
          <div style={{ color: "#d4a017", fontSize: 11, fontWeight: 700, letterSpacing: 3, marginBottom: 6 }}>
            FINAL EXPENSE COVERAGE
          </div>
          <div style={{ color: "#ffffff", fontSize: 26, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1 }}>
            {overlay.headline}
          </div>
        </div>
        <div style={{ padding: "14px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 14, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          {showButtons ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ background: "#d4a017", color: "#000000", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <CheckList bullets={overlay.benefitBullets} color="#e2e8f0" checkColor="#d4a017" padding="0 10px" />
          )}
        </div>
        <BottomBar color="#a16207" label="See What I Qualify For →" />
      </div>
    );
  }

  if (templateIndex === 2) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#f8f5f0" }}>
        <div style={{ background: "#2d2016", padding: "18px 20px 14px", textAlign: "center" }}>
          <div style={{ color: "#d4a017", fontSize: 28, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05, letterSpacing: 1 }}>
            {overlay.headline}
          </div>
        </div>
        <div style={{ padding: "14px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#4a3728", fontSize: 13, fontWeight: 600, marginBottom: 12, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ color: "#2d2016", fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
            SELECT YOUR AGE TO SEE OPTIONS
          </div>
          {showButtons ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ background: "#2d2016", color: "#d4a017", borderRadius: 6, padding: "10px 16px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <CheckList bullets={overlay.benefitBullets} color="#2d2016" checkColor="#a16207" padding="0 10px" />
          )}
        </div>
        <BottomBar color="#2d2016" label="Check My Rate →" />
      </div>
    );
  }

  if (templateIndex === 3) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(160deg, #0f0a06 0%, #1a1206 100%)" }}>
        <div style={{ padding: "22px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#fbbf24", fontSize: 26, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 8 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#e5c88a", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
            {overlay.subheadline}
          </div>
          {showButtons ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ border: "1.5px solid #fbbf24", background: "transparent", color: "#fbbf24", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <CheckList bullets={overlay.benefitBullets} color="#e5c88a" checkColor="#fbbf24" padding="0 10px" />
          )}
        </div>
        <BottomBar color="#92400e" label="See Your Options →" />
      </div>
    );
  }

  return null;
}

function MortgageCreative({
  overlay,
  templateIndex,
}: {
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  const photo = MORTGAGE_PHOTOS[templateIndex % MORTGAGE_PHOTOS.length] || MORTGAGE_BACKGROUND;

  if (templateIndex === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundImage: `url("${photo}")`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
        <div style={{ position: "relative", background: "#ffffff", borderRadius: 8, padding: 16, margin: 20, textAlign: "center", boxShadow: "0 10px 28px rgba(0,0,0,0.22)" }}>
          <div style={{ color: "#b91c1c", fontSize: 22, fontWeight: 900, lineHeight: 1.1 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#555555", fontSize: 12, margin: "6px 0 12px" }}>
            Select your mortgage amount
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "8px 0" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "2px solid #b91c1c", background: "#ffffff", color: "#b91c1c", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          <CheckList bullets={overlay.benefitBullets} color="#166534" checkColor="#16a34a" padding="4px 4px 0" />
        </div>
        <BottomBar color="#b91c1c" label="See My Rate →" />
      </div>
    );
  }

  if (templateIndex === 1) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundImage: `url("${photo}")`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.85) 60%)" }} />
        <div style={{ position: "absolute", bottom: 44, left: 0, right: 0, padding: "0 16px 12px" }}>
          <div style={{ color: "#ffffff", fontSize: 24, fontWeight: 900, textAlign: "center", textTransform: "uppercase", marginBottom: 6 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#fca5a5", fontSize: 12, textAlign: "center", marginBottom: 12 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.15)", border: "1.5px solid #ffffff", color: "#ffffff", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#b91c1c" label="See My Rate →" />
      </div>
    );
  }

  if (templateIndex === 2) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#1a1a2e" }}>
        <div style={{ padding: "20px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 24, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 6 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#f87171", fontSize: 12, marginBottom: 16, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "0 10px" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#16213e", border: "1px solid #b91c1c", borderRadius: 6, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: "#ffffff", fontSize: 14, fontWeight: 700 }}>{label}</span>
                <span style={{ color: "#f87171", fontSize: 11, fontWeight: 700 }}>See My Rate →</span>
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#b91c1c" label="Check My Options →" />
      </div>
    );
  }

  if (templateIndex === 3) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundImage: `url("${photo}")`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, background: "#b91c1c", padding: "14px 20px", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 22, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1 }}>
            {overlay.headline}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 44, left: 0, right: 0, padding: "0 16px 12px", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 12, marginBottom: 10, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#b91c1c", color: "#ffffff", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#b91c1c" label="See My Rate →" />
      </div>
    );
  }

  return null;
}

function IulCreative({
  overlay,
  templateIndex,
}: {
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  const showButtons = overlay.buttonLabels.length > 0;

  if (templateIndex === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(145deg, #0a1628 0%, #0f2040 100%)" }}>
        <div style={{ color: "#d4a017", fontSize: 26, fontWeight: 900, textAlign: "center", padding: "24px 16px 8px", lineHeight: 1.1 }}>
          {overlay.headline}
        </div>
        <div style={{ color: "#93c5fd", fontSize: 12, textAlign: "center", padding: "0 16px 12px", lineHeight: 1.4 }}>
          {overlay.subheadline}
        </div>
        {showButtons ? (
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "0 16px" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "1.5px solid #d4a017", color: "#d4a017", background: "transparent", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        ) : (
          <CheckList bullets={overlay.benefitBullets} />
        )}
        <BottomBar color="#1d4ed8" label="Learn More →" />
      </div>
    );
  }

  if (templateIndex === 1) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0d0d0d" }}>
        <div style={{ background: "linear-gradient(135deg, #1a1200 0%, #0d0d0d 100%)", padding: "22px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#c9a84c", fontSize: 11, fontWeight: 700, letterSpacing: 3, marginBottom: 8 }}>
            INDEXED UNIVERSAL LIFE
          </div>
          <div style={{ color: "#ffffff", fontSize: 26, fontWeight: 900, lineHeight: 1.1, marginBottom: 8 }}>
            {overlay.headline}
          </div>
          <div style={{ borderTop: "1px solid #c9a84c", margin: "0 20px 12px" }} />
          <div style={{ color: "#c9a84c", fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
            {overlay.subheadline}
          </div>
          {showButtons ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ background: "#c9a84c", color: "#000000", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <CheckList bullets={overlay.benefitBullets} color="#c9a84c" checkColor="#d4a017" padding="0 10px" />
          )}
        </div>
        <BottomBar color="#b8860b" label="Learn How It Works →" />
      </div>
    );
  }

  if (templateIndex === 2) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#f0f4ff" }}>
        <div style={{ background: "#1d4ed8", padding: "16px 20px", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>
            FINANCIAL STRATEGY
          </div>
          <div style={{ color: "#ffffff", fontSize: 24, fontWeight: 900, lineHeight: 1.1 }}>
            {overlay.headline}
          </div>
        </div>
        <div style={{ padding: "14px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#1e3a5f", fontSize: 13, fontWeight: 600, marginBottom: 14, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          {showButtons ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ background: "#1d4ed8", color: "#ffffff", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <CheckList bullets={overlay.benefitBullets} color="#1e3a5f" checkColor="#1d4ed8" padding="0 10px" />
          )}
        </div>
        <BottomBar color="#1d4ed8" label="Explore Options →" />
      </div>
    );
  }

  return null;
}

function CreativeRenderer({
  leadType,
  overlay,
  templateIndex,
}: {
  leadType: string;
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  if (leadType === "veteran") return <VeteranCreative overlay={overlay} templateIndex={templateIndex} />;
  if (leadType === "trucker") return <TruckerCreative overlay={overlay} templateIndex={templateIndex} />;
  if (leadType === "mortgage_protection") return <MortgageCreative overlay={overlay} templateIndex={templateIndex} />;
  if (leadType === "iul") return <IulCreative overlay={overlay} templateIndex={templateIndex} />;
  return <FinalExpenseCreative overlay={overlay} templateIndex={templateIndex} />;
}

export default function AdPreviewCard({
  draft,
  selectedStates: _selectedStates = [],
  regenerateAttempts = 0,
  regenerating = false,
  onRegenerate,
}: {
  draft: any;
  selectedStates?: string[];
  regenerateAttempts?: number;
  regenerating?: boolean;
  onRegenerate: () => void;
}) {
  const canRegenerate = regenerateAttempts < 3 && !regenerating;
  const overlay = getOverlay(draft);
  const leadType = cleanText(draft?.leadType || "final_expense");
  const templateIndex = pickTemplate(
    cleanText(draft?.uniquenessFingerprint || draft?.variationType || draft?.winningFamilyId || ""),
    leadType
  );
  const pageName = PAGE_NAMES[leadType] || "Insurance Info Center";
  const accent = PAGE_ACCENTS[leadType] || "#1d4ed8";
  const adHeadline = cleanText(draft?.headline || overlay.headline);
  const fullText = cleanText(draft?.primaryText);
  const truncated = fullText.length > 120;
  const primaryText = truncated ? fullText.slice(0, 120) : fullText;

  return (
    <div
      style={{
        maxWidth: 375,
        width: "100%",
        background: "#ffffff",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div
        style={{
          padding: "12px 14px 8px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            background: `linear-gradient(135deg, ${accent} 0%, #0a0f1a 100%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontWeight: 800,
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          {pageName.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13.5,
              color: "#1c1e21",
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pageName}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#65676b",
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginTop: 1,
            }}
          >
            <span>Sponsored</span>
            <span aria-hidden="true">·</span>
            <span aria-hidden="true">🌐</span>
          </div>
        </div>
        <div style={{ color: "#65676b", fontSize: 20, letterSpacing: 1.5 }}>
          ···
        </div>
      </div>

      {primaryText && (
        <div
          style={{
            padding: "0 14px 10px",
            fontSize: 14,
            color: "#1c1e21",
            lineHeight: 1.5,
          }}
        >
          {primaryText}
          {truncated && (
            <span style={{ color: "#65676b" }}>
              {" "}
              … <span style={{ fontWeight: 600 }}>See more</span>
            </span>
          )}
        </div>
      )}

      <div
        style={{
          position: "relative",
          width: "100%",
          paddingTop: "100%",
          overflow: "hidden",
          background: "#ffffff",
        }}
      >
        <CreativeRenderer leadType={leadType} overlay={overlay} templateIndex={templateIndex} />
      </div>

      <div
        style={{
          background: "#f0f2f5",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid #dddfe2",
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: "#65676b",
              marginBottom: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            covecrm.com
          </div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: "#1c1e21",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {adHeadline}
          </div>
        </div>
        <button
          type="button"
          disabled
          style={{
            background: "#e4e6eb",
            border: "none",
            borderRadius: 6,
            padding: "8px 14px",
            fontWeight: 700,
            fontSize: 13,
            color: "#1c1e21",
            cursor: "default",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          Learn more
        </button>
      </div>

      <div
        style={{
          padding: "10px 14px 12px",
          background: "#f0f2f5",
          borderTop: "1px solid #dddfe2",
        }}
      >
        <button
          type="button"
          onClick={onRegenerate}
          disabled={!canRegenerate}
          style={{
            width: "100%",
            padding: "9px 0",
            borderRadius: 8,
            background: canRegenerate ? accent : "#9ca3af",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: 13,
            border: "none",
            cursor: canRegenerate ? "pointer" : "not-allowed",
            opacity: canRegenerate ? 1 : 0.65,
            transition: "opacity 0.15s",
          }}
        >
          {regenerating
            ? "Regenerating…"
            : canRegenerate
            ? `↺  Regenerate (${3 - regenerateAttempts} left)`
            : "No regenerations left"}
        </button>
      </div>
    </div>
  );
}
