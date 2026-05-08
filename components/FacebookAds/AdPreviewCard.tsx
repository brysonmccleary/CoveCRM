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

function VeteranCreative({ overlay }: { overlay: ReturnType<typeof getOverlay> }) {
  const ctaText = isAgeTapCta(overlay.ctaStrip)
    ? overlay.ctaStrip.replace(/\s*→\s*$/, "").toUpperCase()
    : "TAP YOUR AGE TO SEE IF YOU QUALIFY";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#f5f0e8",
        color: "#1a2744",
      }}
    >
      <div style={{ paddingTop: 20 }}>
        <div
          style={{
            color: "#1a2744",
            fontSize: 32,
            fontWeight: 900,
            textAlign: "center",
            letterSpacing: 2,
            textTransform: "uppercase",
            padding: "0 16px",
            lineHeight: 1.05,
          }}
        >
          {overlay.headline}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: "#8b1a1a",
            margin: "12px auto",
            width: "80%",
          }}
        >
          <div style={{ flex: 1, borderTop: "1px solid #8b1a1a" }} />
          <div style={{ fontSize: 16, lineHeight: 1 }}>★</div>
          <div style={{ flex: 1, borderTop: "1px solid #8b1a1a" }} />
        </div>
        <div
          style={{
            color: "#1a2744",
            fontSize: 13,
            fontWeight: 700,
            textAlign: "center",
            padding: "0 16px",
            lineHeight: 1.35,
          }}
        >
          {overlay.subheadline}
        </div>
        <div style={{ height: 16 }} />
        <div
          style={{
            color: "#1a2744",
            fontSize: 11,
            fontWeight: 700,
            textAlign: "center",
            letterSpacing: 1,
            padding: "0 16px",
          }}
        >
          {ctaText}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "center",
            flexWrap: "wrap",
            margin: "12px 16px",
          }}
        >
          {overlay.buttonLabels.map((label) => (
            <div
              key={label}
              style={{
                background: "#1a2744",
                color: "#ffffff",
                borderRadius: 50,
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
      <BottomBar color="#c0392b" label="Learn more →" />
    </div>
  );
}

function TruckerCreative({ overlay }: { overlay: ReturnType<typeof getOverlay> }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#0a0a0a",
      }}
    >
      <div
        style={{
          minHeight: "100%",
          background: "linear-gradient(180deg, #0a0a0a 0%, #0d1a0d 100%)",
          boxShadow: "inset 0 0 58px rgba(0, 229, 255, 0.16), inset 0 -80px 95px rgba(255, 0, 170, 0.08)",
        }}
      >
        <div
          style={{
            fontSize: 36,
            fontWeight: 900,
            textAlign: "center",
            color: "transparent",
            background: "linear-gradient(90deg, #00e5ff 0%, #00bcd4 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            paddingTop: 20,
            lineHeight: 1,
          }}
        >
          {overlay.headline}
        </div>
        <div
          style={{
            color: "#ff00aa",
            fontSize: 13,
            fontWeight: 700,
            textAlign: "center",
            padding: "8px 16px",
            lineHeight: 1.4,
          }}
        >
          {overlay.subheadline}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            justifyContent: "center",
            flexWrap: "wrap",
            margin: "12px 16px",
          }}
        >
          {overlay.buttonLabels.map((label) => (
            <div
              key={label}
              style={{
                border: "2px solid #00e5ff",
                background: "transparent",
                color: "#ffffff",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 1,
                whiteSpace: "nowrap",
                boxShadow: "0 0 12px rgba(0, 229, 255, 0.28)",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
      <BottomBar color="#1565c0" label="Learn more →" />
    </div>
  );
}

function FinalExpenseCreative({ overlay }: { overlay: ReturnType<typeof getOverlay> }) {
  const showButtons = overlay.buttonLabels.length > 0;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#0f0e0a",
      }}
    >
      <div
        style={{
          color: "#d4a017",
          fontSize: 28,
          fontWeight: 900,
          textAlign: "center",
          padding: "24px 16px 8px",
          textTransform: "uppercase",
          lineHeight: 1.1,
        }}
      >
        {overlay.headline}
      </div>
      <div style={{ borderTop: "1px solid #d4a017", margin: "0 32px 12px" }} />
      <div
        style={{
          color: "#ffffff",
          fontSize: 13,
          textAlign: "center",
          padding: "0 16px",
          lineHeight: 1.4,
        }}
      >
        {overlay.subheadline}
      </div>
      {showButtons ? (
        <div
          style={{
            display: "flex",
            gap: 6,
            justifyContent: "center",
            flexWrap: "wrap",
            margin: "12px 16px",
          }}
        >
          {overlay.buttonLabels.map((label) => (
            <div
              key={label}
              style={{
                border: "1.5px solid #d4a017",
                background: "transparent",
                color: "#d4a017",
                borderRadius: 4,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
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

function MortgageCreative({ overlay }: { overlay: ReturnType<typeof getOverlay> }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundImage: `url("${MORTGAGE_BACKGROUND}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
        }}
      />
      <div
        style={{
          position: "relative",
          background: "#ffffff",
          borderRadius: 8,
          padding: 16,
          margin: 20,
          textAlign: "center",
          boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
        }}
      >
        <div
          style={{
            color: "#b91c1c",
            fontSize: 22,
            fontWeight: 900,
            lineHeight: 1.1,
          }}
        >
          {overlay.headline}
        </div>
        <div style={{ color: "#555555", fontSize: 12, margin: "6px 0 12px" }}>
          Select your mortgage amount
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            justifyContent: "center",
            flexWrap: "wrap",
            margin: "8px 0",
          }}
        >
          {overlay.buttonLabels.map((label) => (
            <div
              key={label}
              style={{
                border: "2px solid #b91c1c",
                background: "#ffffff",
                color: "#b91c1c",
                borderRadius: 6,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </div>
          ))}
        </div>
        <CheckList
          bullets={overlay.benefitBullets}
          color="#166534"
          checkColor="#16a34a"
          padding="4px 4px 0"
        />
      </div>
      <BottomBar color="#b91c1c" label="See My Rate →" />
    </div>
  );
}

function IulCreative({ overlay }: { overlay: ReturnType<typeof getOverlay> }) {
  const showButtons = overlay.buttonLabels.length > 0;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "linear-gradient(145deg, #0a1628 0%, #0f2040 100%)",
      }}
    >
      <div
        style={{
          color: "#d4a017",
          fontSize: 26,
          fontWeight: 900,
          textAlign: "center",
          padding: "24px 16px 8px",
          lineHeight: 1.1,
        }}
      >
        {overlay.headline}
      </div>
      <div
        style={{
          color: "#93c5fd",
          fontSize: 12,
          textAlign: "center",
          padding: "0 16px 12px",
          lineHeight: 1.4,
        }}
      >
        {overlay.subheadline}
      </div>
      {showButtons ? (
        <div
          style={{
            display: "flex",
            gap: 6,
            justifyContent: "center",
            flexWrap: "wrap",
            margin: "0 16px",
          }}
        >
          {overlay.buttonLabels.map((label) => (
            <div
              key={label}
              style={{
                border: "1.5px solid #d4a017",
                color: "#d4a017",
                background: "transparent",
                borderRadius: 4,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
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

function CreativeRenderer({
  leadType,
  overlay,
}: {
  leadType: string;
  overlay: ReturnType<typeof getOverlay>;
}) {
  if (leadType === "veteran") return <VeteranCreative overlay={overlay} />;
  if (leadType === "trucker") return <TruckerCreative overlay={overlay} />;
  if (leadType === "mortgage_protection") return <MortgageCreative overlay={overlay} />;
  if (leadType === "iul") return <IulCreative overlay={overlay} />;
  return <FinalExpenseCreative overlay={overlay} />;
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
        <CreativeRenderer leadType={leadType} overlay={overlay} />
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
