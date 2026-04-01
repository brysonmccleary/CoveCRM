import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import DashboardLayout from "@/components/DashboardLayout";
import { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

type ProvenAd = {
  _id: string;
  sourceBrand: string;
  sourceType: string;
  title: string;
  leadType: string;
  format: string;
  angleTags: string[];
  hookType: string;
  audience: string;
  primaryText: string;
  headline: string;
  cta: string;
  visualNotes: string;
  landingPageType: string;
  landingPageNotes: string;
  whyItWorks: string;
  complianceNotes: string;
  cloneNotes: string;
  likelyWinnerScore: number;
  createdAt: string;
};

const leadTypeOptions = [
  { value: "", label: "All lead types" },
  { value: "mortgage_protection", label: "Mortgage Protection" },
  { value: "final_expense", label: "Final Expense" },
  { value: "veteran", label: "Veteran" },
  { value: "iul", label: "IUL" },
  { value: "trucker", label: "Trucker" },
];

export default function ProvenLibraryPage() {
  const { data: session } = useSession();
  const [ads, setAds] = useState<ProvenAd[]>([]);
  const [loading, setLoading] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [leadType, setLeadType] = useState("");

  const [newAd, setNewAd] = useState({
    sourceBrand: "",
    title: "",
    leadType: "mortgage_protection",
    format: "image",
    primaryText: "",
    headline: "",
    cta: "",
    angleTags: "",
    whyItWorks: "",
    cloneNotes: "",
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (leadType) params.set("leadType", leadType);
      params.set("limit", "200");

      const res = await fetch(`/api/facebook/proven-ads?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load library");
      setAds(data.ads || []);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const seedDefaults = async () => {
    setSeedLoading(true);
    setError("");
    try {
      const res = await fetch("/api/facebook/proven-ads/seed-defaults", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Seed failed");
      await load();
      alert("Seeded / refreshed proven ads.");
    } catch (e: any) {
      setError(e.message || "Seed failed");
    } finally {
      setSeedLoading(false);
    }
  };

  const createAd = async () => {
    setError("");
    if (!newAd.title || !newAd.leadType) {
      setError("Title and lead type are required.");
      return;
    }
    try {
      const res = await fetch("/api/facebook/proven-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceBrand: newAd.sourceBrand,
          title: newAd.title,
          leadType: newAd.leadType,
          format: newAd.format,
          primaryText: newAd.primaryText,
          headline: newAd.headline,
          cta: newAd.cta,
          angleTags: newAd.angleTags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          whyItWorks: newAd.whyItWorks,
          cloneNotes: newAd.cloneNotes,
          sourceType: "manual",
          likelyWinnerScore: 70,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setNewAd({
        sourceBrand: "",
        title: "",
        leadType: "mortgage_protection",
        format: "image",
        primaryText: "",
        headline: "",
        cta: "",
        angleTags: "",
        whyItWorks: "",
        cloneNotes: "",
      });
      await load();
    } catch (e: any) {
      setError(e.message || "Failed to save");
    }
  };

  const filteredCount = useMemo(() => ads.length, [ads]);

  return (
    <DashboardLayout>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px", color: "#e5e7eb" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Proven Ads Library</h1>
        <p style={{ color: "#94a3b8", marginBottom: 24 }}>
          Permanent swipe file for winning insurance ads, hooks, funnels, and clone notes.
        </p>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search hooks, brands, angles, copy..."
            style={{
              flex: 1,
              minWidth: 260,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#fff",
            }}
          />
          <select
            value={leadType}
            onChange={(e) => setLeadType(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#fff",
            }}
          >
            {leadTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={load}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "none",
              background: "#2563eb",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button
            onClick={seedDefaults}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0f172a",
              color: "#93c5fd",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {seedLoading ? "Seeding..." : "Seed Current Winners"}
          </button>
        </div>

        {error && (
          <div style={{
            marginBottom: 16,
            padding: 12,
            background: "rgba(127,29,29,0.2)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 8,
            color: "#fca5a5",
          }}>
            {error}
          </div>
        )}

        <div style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1.4fr",
          gap: 20,
          alignItems: "start",
        }}>
          <div style={{
            background: "#0f172a",
            border: "1px solid #1e293b",
            borderRadius: 12,
            padding: 18,
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Add Proven Ad</h2>

            <div style={{ display: "grid", gap: 10 }}>
              <input
                value={newAd.sourceBrand}
                onChange={(e) => setNewAd({ ...newAd, sourceBrand: e.target.value })}
                placeholder="Source brand (e.g. Sitka Life)"
                style={inputStyle}
              />
              <input
                value={newAd.title}
                onChange={(e) => setNewAd({ ...newAd, title: e.target.value })}
                placeholder="Internal title"
                style={inputStyle}
              />
              <select
                value={newAd.leadType}
                onChange={(e) => setNewAd({ ...newAd, leadType: e.target.value })}
                style={inputStyle}
              >
                {leadTypeOptions.filter((x) => x.value).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                value={newAd.format}
                onChange={(e) => setNewAd({ ...newAd, format: e.target.value })}
                style={inputStyle}
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
                <option value="carousel">Carousel</option>
                <option value="instant_form">Instant Form</option>
                <option value="landing_page">Landing Page</option>
                <option value="unknown">Unknown</option>
              </select>
              <input
                value={newAd.headline}
                onChange={(e) => setNewAd({ ...newAd, headline: e.target.value })}
                placeholder="Headline"
                style={inputStyle}
              />
              <input
                value={newAd.cta}
                onChange={(e) => setNewAd({ ...newAd, cta: e.target.value })}
                placeholder="CTA"
                style={inputStyle}
              />
              <input
                value={newAd.angleTags}
                onChange={(e) => setNewAd({ ...newAd, angleTags: e.target.value })}
                placeholder="Angle tags (comma-separated)"
                style={inputStyle}
              />
              <textarea
                value={newAd.primaryText}
                onChange={(e) => setNewAd({ ...newAd, primaryText: e.target.value })}
                placeholder="Primary text / visible copy"
                style={textareaStyle}
              />
              <textarea
                value={newAd.whyItWorks}
                onChange={(e) => setNewAd({ ...newAd, whyItWorks: e.target.value })}
                placeholder="Why it works"
                style={textareaStyle}
              />
              <textarea
                value={newAd.cloneNotes}
                onChange={(e) => setNewAd({ ...newAd, cloneNotes: e.target.value })}
                placeholder="Clone notes / how to rewrite"
                style={textareaStyle}
              />

              <button
                onClick={createAd}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "#2563eb",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Save Proven Ad
              </button>
            </div>
          </div>

          <div>
            <div style={{ color: "#94a3b8", marginBottom: 10 }}>
              {filteredCount} saved entries
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              {ads.map((ad) => (
                <div
                  key={ad._id}
                  style={{
                    background: "#0f172a",
                    border: "1px solid #1e293b",
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{ad.title}</div>
                      <div style={{ color: "#93c5fd", fontSize: 13, marginTop: 4 }}>
                        {ad.sourceBrand || "Unknown source"} • {ad.leadType} • {ad.format}
                      </div>
                    </div>
                    <div style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "rgba(37,99,235,0.15)",
                      color: "#93c5fd",
                      fontSize: 12,
                      fontWeight: 700,
                      height: "fit-content",
                    }}>
                      Score {ad.likelyWinnerScore || 0}
                    </div>
                  </div>

                  {ad.headline ? (
                    <div style={{ marginBottom: 8, color: "#fff", fontWeight: 600 }}>
                      {ad.headline}
                    </div>
                  ) : null}

                  {ad.angleTags?.length ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                      {ad.angleTags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            padding: "3px 8px",
                            borderRadius: 999,
                            background: "#111827",
                            border: "1px solid #374151",
                            color: "#cbd5e1",
                            fontSize: 12,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {ad.primaryText ? (
                    <div style={{ whiteSpace: "pre-wrap", color: "#cbd5e1", lineHeight: 1.55, marginBottom: 12 }}>
                      {ad.primaryText}
                    </div>
                  ) : null}

                  {ad.whyItWorks ? (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: "#60a5fa", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
                        Why it works
                      </div>
                      <div style={{ color: "#cbd5e1" }}>{ad.whyItWorks}</div>
                    </div>
                  ) : null}

                  {ad.cloneNotes ? (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: "#60a5fa", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
                        Clone notes
                      </div>
                      <div style={{ color: "#cbd5e1" }}>{ad.cloneNotes}</div>
                    </div>
                  ) : null}

                  {ad.landingPageNotes ? (
                    <div>
                      <div style={{ fontSize: 12, color: "#60a5fa", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
                        Funnel notes
                      </div>
                      <div style={{ color: "#cbd5e1" }}>{ad.landingPageNotes}</div>
                    </div>
                  ) : null}
                </div>
              ))}

              {!loading && ads.length === 0 ? (
                <div style={{
                  background: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: 12,
                  padding: 24,
                  color: "#94a3b8",
                }}>
                  No proven ads saved yet. Click “Seed Current Winners” first.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #334155",
  background: "#020617",
  color: "#fff",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 100,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #334155",
  background: "#020617",
  color: "#fff",
  resize: "vertical",
};

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  if (!session?.user?.email) {
    return {
      redirect: {
        destination: "/login",
        permanent: false,
      },
    };
  }

  return { props: {} };
};
