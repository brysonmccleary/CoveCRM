// components/home/StatsBar.tsx
import { useEffect, useRef, useState } from "react";

type Stat = {
  to: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  label: string;
  sublabel?: string;
};

const STATS: Stat[] = [
  { to: 10000, suffix: "+", label: "Calls Dialed" },
  { to: 15, suffix: "+", label: "Avg Hours Saved Per Week" },
  { to: 3, suffix: "+", label: "Avg Live Transfers Per Day" },
  { to: 30, suffix: "+", label: "Client Touchpoints in Year 1" },
];

function StatCounter({ stat }: { stat: Stat }) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          obs.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setValue(stat.to);
      return;
    }
    const duration = 1600;
    let startTime: number | null = null;
    let rafId: number;
    const animate = (ts: number) => {
      if (!startTime) startTime = ts;
      const elapsed = ts - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * stat.to;
      setValue(parseFloat(current.toFixed(stat.decimals ?? 0)));
      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      } else {
        setValue(stat.to);
      }
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [active, stat]);

  const display =
    stat.decimals != null
      ? value.toFixed(stat.decimals)
      : Math.round(value).toLocaleString();

  return (
    <div
      ref={ref}
      className="stats-cell"
      style={{ textAlign: "center", padding: "1.5rem 1rem" }}
    >
      <div
        style={{
          fontFamily: "'Sora', sans-serif",
          fontSize: "clamp(1.8rem, 3.5vw, 2.4rem)",
          fontWeight: 800,
          color: "#fff",
          lineHeight: 1.1,
          letterSpacing: "-0.02em",
        }}
      >
        {stat.prefix ?? ""}
        {display}
        {stat.suffix ?? ""}
        {stat.sublabel && (
          <span style={{ fontSize: "0.85rem", fontWeight: 400, color: "#475569", marginLeft: "5px" }}>
            {stat.sublabel}
          </span>
        )}
      </div>
      <div
        style={{
          color: "#475569",
          fontSize: "11px",
          marginTop: "6px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {stat.label}
      </div>
    </div>
  );
}

export default function StatsBar() {
  return (
    <div
      style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, #020617 0%, #07101f 100%)",
        padding: "2rem 1.5rem",
      }}
    >
      <div className="stats-grid" style={{ maxWidth: "1000px", margin: "0 auto" }}>
        {STATS.map((stat, i) => (
          <StatCounter key={i} stat={stat} />
        ))}
      </div>
      <style>{`
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
        }
        .stats-cell {
          border-right: 1px solid rgba(255,255,255,0.08);
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .stats-cell:nth-child(2n) {
          border-right: none;
        }
        .stats-cell:nth-last-child(-n+2) {
          border-bottom: none;
        }
        @media (min-width: 1024px) {
          .stats-grid {
            grid-template-columns: repeat(4, 1fr);
          }
          .stats-cell {
            border-right: 1px solid rgba(255,255,255,0.08) !important;
            border-bottom: none !important;
          }
          .stats-cell:last-child {
            border-right: none !important;
          }
        }
      `}</style>
    </div>
  );
}
