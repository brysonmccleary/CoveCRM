// components/home/KaylaSection.tsx
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Shared purple accent — #7c3aed (violet-600), matches outgoing SMS bubbles site-wide
const PURPLE = "#7c3aed";
const pa = (a: number) => `rgba(124,58,237,${a})`;

const ACTIVITY_ITEMS = [
  { text: "Calling lead — Final Expense", type: "neutral" },
  { text: "No answer — moved to next", type: "neutral" },
  { text: "Booked appointment ✔", type: "positive" },
  { text: "Live transfer in progress", type: "active" },
];

function DialSessionCard({ reduced }: { reduced: boolean }) {
  const [dialCount, setDialCount] = useState(182);
  const [feedIdx, setFeedIdx] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const dialTimer = setInterval(
      () => setDialCount((c) => (c >= 400 ? 110 : c + 1)),
      800,
    );
    const feedTimer = setInterval(
      () => setFeedIdx((i) => (i + 1) % ACTIVITY_ITEMS.length),
      3600,
    );
    return () => {
      clearInterval(dialTimer);
      clearInterval(feedTimer);
    };
  }, [reduced]);

  const item = ACTIVITY_ITEMS[feedIdx];

  const dotColor = (type: string) =>
    type === "positive" ? PURPLE : type === "active" ? "#60a5fa" : "#334155";
  const textColor = (type: string) =>
    type === "positive" ? "#c4b5fd" : type === "active" ? "#93c5fd" : "#64748b";

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #0d1a35 0%, #060e1f 100%)",
        border: `1px solid ${pa(0.3)}`,
        borderRadius: "20px",
        padding: "22px 22px 20px",
        width: "100%",
        maxWidth: "340px",
        boxShadow: `0 0 40px ${pa(0.15)}, 0 0 80px rgba(59,130,246,0.06)`,
      }}
    >
      {/* Eyebrow + live badge */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
        <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase", color: "#64748b" }}>
          Dial Session In Progress
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "5px", background: pa(0.15), border: `1px solid ${pa(0.3)}`, borderRadius: "9999px", padding: "2px 9px" }}>
          <span className="live-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: PURPLE, flexShrink: 0 }} />
          <span style={{ fontSize: "9px", color: "#c4b5fd", fontWeight: 700 }}>LIVE</span>
        </span>
      </div>

      {/* Headline */}
      <p style={{ fontFamily: "'Sora', sans-serif", color: "#fff", fontWeight: 700, fontSize: "15px", margin: "0 0 4px" }}>
        Kayla is calling 400 leads
      </p>

      {/* Progress counter + bar */}
      <p style={{ color: "#64748b", fontSize: "11px", margin: "0 0 10px" }}>
        <span style={{ color: "#c4b5fd", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {dialCount}
        </span>
        {" / 400 dialed"}
      </p>
      <div style={{ height: "4px", background: "rgba(255,255,255,0.07)", borderRadius: "2px", marginBottom: "18px", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${(dialCount / 400) * 100}%`,
            background: `linear-gradient(90deg, ${PURPLE}, #a78bfa)`,
            borderRadius: "2px",
            transition: reduced ? "none" : "width 0.8s ease",
          }}
        />
      </div>

      {/* Activity feed */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "14px" }}>
        <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#334155", marginBottom: "8px" }}>
          Activity
        </p>
        {reduced ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
            {ACTIVITY_ITEMS.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: dotColor(a.type), flexShrink: 0 }} />
                <span style={{ fontSize: "11px", color: textColor(a.type) }}>{a.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <div
            key={feedIdx}
            className="kayla-feed-item"
            style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "20px" }}
          >
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: dotColor(item.type), flexShrink: 0 }} />
            <span style={{ fontSize: "11px", color: textColor(item.type) }}>{item.text}</span>
          </div>
        )}
      </div>

      {/* Bottom stat row */}
      <div style={{ display: "flex", gap: "8px", marginTop: "14px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ flex: 1, textAlign: "center", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.18)", borderRadius: "8px", padding: "7px 4px" }}>
          <p style={{ color: "#4ade80", fontWeight: 700, fontSize: "13px", margin: 0, fontVariantNumeric: "tabular-nums" }}>6</p>
          <p style={{ color: "#166534", fontSize: "9px", margin: "1px 0 0" }}>Booked</p>
        </div>
        <div style={{ flex: 1, textAlign: "center", background: pa(0.1), border: `1px solid ${pa(0.2)}`, borderRadius: "8px", padding: "7px 4px" }}>
          <p style={{ color: "#c4b5fd", fontWeight: 700, fontSize: "13px", margin: 0, fontVariantNumeric: "tabular-nums" }}>2</p>
          <p style={{ color: "#4c1d95", fontSize: "9px", margin: "1px 0 0" }}>Transferred</p>
        </div>
        <div style={{ flex: 1, textAlign: "center", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "7px 4px" }}>
          <p style={{ color: "#475569", fontWeight: 700, fontSize: "13px", margin: 0, fontVariantNumeric: "tabular-nums" }}>218</p>
          <p style={{ color: "#1e293b", fontSize: "9px", margin: "1px 0 0" }}>Remaining</p>
        </div>
      </div>
    </div>
  );
}

export default function KaylaSection() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  return (
    <section
      style={{
        background: "linear-gradient(180deg, #020617 0%, #07101f 60%, #020617 100%)",
        borderTop: "1px solid rgba(99,102,241,0.12)",
        borderBottom: "1px solid rgba(99,102,241,0.12)",
        padding: "5rem 1.5rem",
      }}
    >
      <div
        className="kayla-inner"
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "3.5rem",
        }}
      >
        {/* Text side */}
        <div style={{ maxWidth: "560px", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", color: "#a78bfa" }}>
              AI Voice Agent
            </span>
            <span style={{ borderRadius: "9999px", background: pa(0.15), border: `1px solid ${pa(0.3)}`, padding: "2px 10px", fontSize: "10px", color: "#c4b5fd", fontWeight: 600 }}>
              Always-On
            </span>
          </div>

          <h2
            style={{
              fontFamily: "'Sora', sans-serif",
              fontSize: "clamp(1.9rem, 4vw, 2.8rem)",
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1.15,
              marginBottom: "1.25rem",
              letterSpacing: "-0.02em",
            }}
          >
            Meet Kayla —{" "}
            <span
              style={{
                background: "linear-gradient(90deg, #a78bfa, #818cf8, #60a5fa)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Your AI Appointment Setter
            </span>
          </h2>

          <p style={{ color: "#cbd5e1", fontSize: "1rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
            A fully autonomous calling agent that dials your leads, handles objections using proven insurance
            scripts, and books real appointments directly on your Google Calendar — all while you focus on
            closing.
          </p>

          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 2rem", display: "flex", flexDirection: "column", gap: "10px" }}>
            {[
              "Calls through your existing Cove numbers.",
              "Books appointments into your real Google Calendar in the correct time zone.",
              "Runs quietly in the background while you work, travel, or take the day off.",
            ].map((point) => (
              <li key={point} style={{ display: "flex", alignItems: "flex-start", gap: "10px", color: "#94a3b8", fontSize: "14px", lineHeight: 1.5 }}>
                <span style={{ color: "#a78bfa", marginTop: "1px", flexShrink: 0 }}>✔</span>
                {point}
              </li>
            ))}
          </ul>

          <Link href="/kayla">
            <button
              style={{
                background: `linear-gradient(135deg, #4f46e5, ${PURPLE})`,
                color: "#fff",
                padding: "0.75rem 1.75rem",
                borderRadius: "12px",
                fontWeight: 700,
                fontSize: "14px",
                border: `1px solid ${pa(0.4)}`,
                cursor: "pointer",
                boxShadow: "0 0 24px rgba(99,102,241,0.35)",
                transition: "box-shadow 0.2s",
                fontFamily: "'Sora', sans-serif",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 36px rgba(99,102,241,0.55)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 24px rgba(99,102,241,0.35)";
              }}
            >
              Meet Kayla →
            </button>
          </Link>
        </div>

        {/* Card side */}
        <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
          <DialSessionCard reduced={reduced} />
        </div>
      </div>

      <style>{`
        @keyframes kayla-feed-in {
          from { opacity: 0; transform: translateY(5px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .kayla-feed-item {
          animation: kayla-feed-in 0.45s ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .kayla-feed-item { animation: none !important; }
        }
        @media (min-width: 1024px) {
          .kayla-inner {
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
          }
          .kayla-inner > div:last-child {
            justify-content: flex-end !important;
          }
        }
      `}</style>
    </section>
  );
}
