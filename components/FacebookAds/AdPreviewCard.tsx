// components/FacebookAds/AdPreviewCard.tsx
// Mobile Facebook ad preview rendered entirely with inline styles — no Tailwind layout classes.

const PAGE_NAMES: Record<string, string> = {
  veteran: "Veteran Benefits Center",
  trucker: "Trucker Life Coverage",
  final_expense: "Final Expense Planning",
  mortgage_protection: "Mortgage Protection Center",
  iul: "IUL Education Center",
};

function cleanButtonLabel(raw: string): string {
  return String(raw || "")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isValidButtonLabel(raw: string): boolean {
  const t = cleanButtonLabel(raw);
  if (!t || t.length <= 1) return false;
  if (t === "O") return false;
  return (
    t.startsWith("$") ||
    /^\d/.test(t) ||
    /^Under\b/i.test(t) ||
    /^Ages?\b/i.test(t) ||
    /^AGE\b/.test(t)
  );
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

  // Support both overlayData (creativeStyleRules path) and landingPageConfig (winningAdLibrary path)
  const overlay = draft?.overlayData || draft?.landingPageConfig || {};
  const headline: string = String(overlay.headline || draft?.headline || "");
  const subheadline: string = String(overlay.subheadline || "");
  const ctaStrip: string = String(overlay.ctaStrip || "");
  const rawButtons: string[] = Array.isArray(overlay.buttonLabels) ? overlay.buttonLabels : [];
  const bullets: string[] = Array.isArray(overlay.benefitBullets) ? overlay.benefitBullets : [];

  const buttonLabels = rawButtons.filter(isValidButtonLabel).map(cleanButtonLabel).slice(0, 4);
  const showButtons = buttonLabels.length > 0;
  const showBullets = !showButtons && bullets.length > 0;

  const leadType = String(draft?.leadType || "final_expense");
  const pageName = PAGE_NAMES[leadType] || "Insurance Info Center";
  const adHeadline = String(draft?.headline || headline);
  const imageUrl = String(draft?.imageUrl || "");

  // Truncate primary text to ~120 chars for the feed preview
  const fullText = String(draft?.primaryText || "");
  const truncated = fullText.length > 120;
  const primaryText = truncated ? fullText.slice(0, 120) : fullText;

  // Accent color per lead type
  const ACCENT: Record<string, string> = {
    veteran: "#1d4ed8",
    trucker: "#d97706",
    final_expense: "#a16207",
    mortgage_protection: "#b91c1c",
    iul: "#1d4ed8",
  };
  const accent = ACCENT[leadType] || "#1d4ed8";

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
      {/* ── Facebook post header ────────────────────────────────── */}
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
            <span aria-hidden>·</span>
            <span style={{ fontSize: 11 }}>🌐</span>
          </div>
        </div>
        {/* three-dot menu placeholder */}
        <div style={{ color: "#65676b", fontSize: 20, letterSpacing: 1.5, cursor: "default" }}>
          ···
        </div>
      </div>

      {/* ── Primary text ───────────────────────────────────────── */}
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
              …{" "}
              <span
                style={{ cursor: "pointer", fontWeight: 600 }}
              >
                See more
              </span>
            </span>
          )}
        </div>
      )}

      {/* ── Image area with bottom overlay panel ───────────────── */}
      <div
        style={{
          position: "relative",
          width: "100%",
          paddingTop: "100%", // 1:1 square
          background: "#0a0f1a",
          overflow: "hidden",
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Ad creative"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: `linear-gradient(145deg, #0a0f1a 0%, #1e3a5f 100%)`,
              color: "#4b6cb7",
              fontSize: 13,
            }}
          >
            Creative generating…
          </div>
        )}

        {/* Dark overlay panel at bottom of image */}
        {(headline || subheadline || showButtons || showBullets || ctaStrip) && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background: "rgba(8, 12, 26, 0.91)",
              padding: "12px 12px 11px",
            }}
          >
            {headline && (
              <div
                style={{
                  color: "#ffffff",
                  fontWeight: 800,
                  fontSize: headline.length > 30 ? 13.5 : 16.5,
                  lineHeight: 1.25,
                  letterSpacing: 0.4,
                  marginBottom: 4,
                }}
              >
                {headline}
              </div>
            )}

            {subheadline && (
              <div
                style={{
                  color: "#c8d6e5",
                  fontSize: 11,
                  lineHeight: 1.4,
                  marginBottom: showButtons || showBullets ? 9 : 5,
                }}
              >
                {subheadline}
              </div>
            )}

            {/* Age / amount buttons */}
            {showButtons && (
              <div
                style={{
                  display: "flex",
                  gap: 5,
                  flexWrap: "wrap",
                  marginBottom: ctaStrip ? 8 : 2,
                }}
              >
                {buttonLabels.map((label) => (
                  <div
                    key={label}
                    style={{
                      background: "#111827",
                      border: `1.5px solid ${accent}`,
                      borderRadius: 6,
                      padding: "5px 9px",
                      color: "#e8efff",
                      fontSize: label.length > 10 ? 9.5 : 10.5,
                      fontWeight: 700,
                      letterSpacing: 0.2,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      textAlign: "center",
                    }}
                  >
                    {label}
                  </div>
                ))}
              </div>
            )}

            {/* Benefit bullets shown when no buttons */}
            {showBullets && (
              <ul
                style={{
                  listStyle: "none",
                  margin: "0 0 6px",
                  padding: 0,
                }}
              >
                {bullets.slice(0, 3).map((b, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "flex-start",
                      marginBottom: 3,
                    }}
                  >
                    <span
                      style={{
                        color: "#22c55e",
                        fontWeight: 700,
                        fontSize: 12,
                        lineHeight: 1.4,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </span>
                    <span
                      style={{ color: "#c8d6e5", fontSize: 11, lineHeight: 1.4 }}
                    >
                      {b}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* CTA strip */}
            {ctaStrip && (
              <div
                style={{
                  color: "#93c5fd",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  borderTop: "1px solid rgba(255,255,255,0.12)",
                  paddingTop: 7,
                  marginTop: 4,
                }}
              >
                {ctaStrip}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Facebook CTA bar ────────────────────────────────────── */}
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

      {/* ── Regenerate button ───────────────────────────────────── */}
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
