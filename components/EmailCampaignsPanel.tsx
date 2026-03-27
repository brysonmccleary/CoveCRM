// components/EmailCampaignsPanel.tsx
// Email campaign manager: list, create, AI-generate steps, prebuilt templates.
import { useEffect, useState } from "react";
import axios from "axios";

interface CampaignStep {
  day: number;
  subject: string;
  html: string;
  text: string;
}

interface Campaign {
  _id: string;
  name: string;
  steps: CampaignStep[];
  dailyLimit: number;
  isActive: boolean;
}

const PREBUILT_TEMPLATES: { name: string; steps: CampaignStep[] }[] = [
  {
    name: "New Agent Welcome Sequence",
    steps: [
      {
        day: 0,
        subject: "Welcome to our agency — next steps",
        html: "<p>Hi there,</p><p>Welcome! We're excited to have you consider joining our team. Reply to this email with any questions you have about our onboarding process.</p><p>To unsubscribe, reply STOP.</p>",
        text: "Hi there, Welcome! We're excited to have you consider joining our team. Reply with any questions about onboarding. To unsubscribe, reply STOP.",
      },
      {
        day: 3,
        subject: "Quick follow-up — have you had a chance to review?",
        html: "<p>Hi,</p><p>Just following up on my previous message. I'd love to schedule a quick 15-minute call to share more about what we offer our agents.</p><p>To unsubscribe, reply STOP.</p>",
        text: "Just following up. I'd love to schedule a quick call to share more about what we offer. To unsubscribe, reply STOP.",
      },
      {
        day: 7,
        subject: "Last outreach — still interested?",
        html: "<p>Hi,</p><p>I don't want to keep filling your inbox, so this will be my last email. If you're ever interested in discussing opportunities with our agency, my door is always open.</p><p>To unsubscribe, reply STOP.</p>",
        text: "This is my last email. If you're ever interested, my door is always open. To unsubscribe, reply STOP.",
      },
    ],
  },
  {
    name: "High-Earning Agent Recruitment",
    steps: [
      {
        day: 0,
        subject: "Opportunity for licensed L&H agents in your area",
        html: "<p>Hi,</p><p>I noticed your active life & health license and wanted to reach out. Our agency supports independent agents with leads, technology, and back-office support so you can focus on writing business.</p><p>Interested in learning more? Reply to this email.</p><p>To unsubscribe, reply STOP.</p>",
        text: "Hi, I noticed your active L&H license. Our agency supports independent agents with leads, tech, and back-office support. Interested? Reply to learn more. To unsubscribe, reply STOP.",
      },
      {
        day: 5,
        subject: "Still open to learning more?",
        html: "<p>Hi,</p><p>I wanted to follow up on my earlier note. Many agents find that joining our network helps them write more policies while spending less time on admin. Happy to do a quick call if you're open to it.</p><p>To unsubscribe, reply STOP.</p>",
        text: "Following up — many agents in our network write more policies while spending less time on admin. Happy to do a quick call. To unsubscribe, reply STOP.",
      },
    ],
  },
  {
    name: "AEP Season Recruiting",
    steps: [
      {
        day: 0,
        subject: "AEP is coming — are you maximizing your book?",
        html: "<p>Hi,</p><p>Annual Enrollment Period is around the corner. Our agents have access to top Medicare Advantage carriers and dedicated support through the busy season. Want to learn how we can help?</p><p>To unsubscribe, reply STOP.</p>",
        text: "AEP is coming. Our agents have access to top MA carriers and support through the busy season. Want to learn more? To unsubscribe, reply STOP.",
      },
      {
        day: 4,
        subject: "Get ready for AEP with our agency",
        html: "<p>Hi,</p><p>Just a quick follow-up. Agents who join before AEP get access to our full carrier lineup and a dedicated onboarding specialist. Spots are limited — reply to get started.</p><p>To unsubscribe, reply STOP.</p>",
        text: "Agents who join before AEP get our full carrier lineup and a dedicated onboarding specialist. Spots are limited — reply to get started. To unsubscribe, reply STOP.",
      },
      {
        day: 10,
        subject: "One last note before AEP kicks off",
        html: "<p>Hi,</p><p>AEP is almost here. If you haven't found a home for your book yet, I'd love to connect before the season starts. This is my last email unless I hear from you.</p><p>To unsubscribe, reply STOP.</p>",
        text: "AEP is almost here. If you haven't found a home for your book yet, let's connect before the season. This is my last email unless I hear from you. To unsubscribe, reply STOP.",
      },
    ],
  },
  {
    name: "Re-engagement Drip",
    steps: [
      {
        day: 0,
        subject: "We haven't connected yet — quick question",
        html: "<p>Hi,</p><p>I reached out a little while ago but never heard back. I understand you're busy — I just wanted to ask: are you actively looking for agency support right now, or is the timing not right?</p><p>Either way, no hard feelings. To unsubscribe, reply STOP.</p>",
        text: "Are you actively looking for agency support right now, or is the timing not right? No hard feelings either way. To unsubscribe, reply STOP.",
      },
      {
        day: 7,
        subject: "Keeping the door open",
        html: "<p>Hi,</p><p>This will be my last follow-up. If you ever want to explore what our agency can offer, feel free to reach out anytime. Wishing you a great season.</p><p>To unsubscribe, reply STOP.</p>",
        text: "This is my last follow-up. If you ever want to explore what we offer, feel free to reach out anytime. To unsubscribe, reply STOP.",
      },
    ],
  },
];

const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "urgent", label: "Urgent" },
] as const;

type Tone = "professional" | "casual" | "urgent";

export default function EmailCampaignsPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  // Builder state
  const [builderName, setBuilderName] = useState("");
  const [builderDailyLimit, setBuilderDailyLimit] = useState(50);
  const [builderSteps, setBuilderSteps] = useState<CampaignStep[]>([]);
  const [saving, setSaving] = useState(false);

  // Per-step AI generation state
  const [stepAiPrompt, setStepAiPrompt] = useState<Record<number, string>>({});
  const [stepAiTone, setStepAiTone] = useState<Record<number, Tone>>({});
  const [stepGenerating, setStepGenerating] = useState<Record<number, boolean>>({});

  // Subject scorer
  const [scoringIdx, setScoringIdx] = useState<number | null>(null);
  const [scoreResult, setScoreResult] = useState<{
    idx: number;
    score: number;
    feedback: string;
    suggestions: string[];
  } | null>(null);

  // Edit modal
  const [editId, setEditId] = useState<string | null>(null);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/api/email/campaigns");
      setCampaigns(Array.isArray(res.data) ? res.data : []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  // ── Campaign list actions ──────────────────────────────────────────────────

  const togglePause = async (c: Campaign) => {
    try {
      await axios.patch(`/api/email/campaigns/${c._id}`, { isActive: !c.isActive });
      setCampaigns((prev) =>
        prev.map((x) => (x._id === c._id ? { ...x, isActive: !c.isActive } : x))
      );
    } catch {
      alert("Failed to update campaign.");
    }
  };

  const deleteCampaign = async (id: string) => {
    if (!confirm("Delete this campaign? Enrollments will not be affected.")) return;
    try {
      await axios.delete(`/api/email/campaigns/${id}`);
      setCampaigns((prev) => prev.filter((c) => c._id !== id));
    } catch {
      alert("Failed to delete campaign.");
    }
  };

  // ── Builder helpers ────────────────────────────────────────────────────────

  const addBuilderStep = () => {
    setBuilderSteps((prev) => [
      ...prev,
      { day: prev.length === 0 ? 0 : (prev[prev.length - 1]?.day ?? 0) + 3, subject: "", html: "", text: "" },
    ]);
  };

  const removeBuilderStep = (idx: number) => {
    setBuilderSteps((prev) => prev.filter((_, i) => i !== idx));
    setStepAiPrompt((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
    setScoreResult(null);
  };

  const updateBuilderStep = (idx: number, field: keyof CampaignStep, value: string | number) => {
    setBuilderSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s))
    );
    if (field === "subject" && scoreResult?.idx === idx) setScoreResult(null);
  };

  const generateStepContent = async (idx: number) => {
    const prompt = stepAiPrompt[idx]?.trim();
    if (!prompt) {
      alert("Enter a prompt for this step first.");
      return;
    }
    setStepGenerating((prev) => ({ ...prev, [idx]: true }));
    try {
      const res = await axios.post("/api/ai/generate-email", {
        prompt,
        stepNumber: idx + 1,
        campaignName: builderName || "Email Campaign",
        tone: stepAiTone[idx] || "professional",
      });
      updateBuilderStep(idx, "subject", res.data.subject);
      updateBuilderStep(idx, "html", res.data.html);
      updateBuilderStep(idx, "text", res.data.text);
    } catch (err: any) {
      alert(err?.response?.data?.error || "AI generation failed");
    } finally {
      setStepGenerating((prev) => ({ ...prev, [idx]: false }));
    }
  };

  const scoreSubject = async (idx: number) => {
    const subject = builderSteps[idx]?.subject?.trim();
    if (!subject) {
      alert("Enter a subject line first.");
      return;
    }
    setScoringIdx(idx);
    try {
      const res = await axios.post("/api/ai/score-subject", { subject });
      setScoreResult({ idx, ...res.data });
    } catch {
      alert("Scoring failed");
    } finally {
      setScoringIdx(null);
    }
  };

  const saveBuilderCampaign = async () => {
    if (!builderName.trim()) {
      alert("Enter a campaign name.");
      return;
    }
    if (builderSteps.length === 0) {
      alert("Add at least one step.");
      return;
    }
    for (let i = 0; i < builderSteps.length; i++) {
      const s = builderSteps[i];
      if (!s.subject.trim() || !s.html.trim()) {
        alert(`Step ${i + 1} needs a subject and body.`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await axios.post("/api/email/campaigns", {
        name: builderName.trim(),
        steps: builderSteps,
        dailyLimit: builderDailyLimit,
      });
      setCampaigns((prev) => [...prev, res.data]);
      setBuilderName("");
      setBuilderDailyLimit(50);
      setBuilderSteps([]);
      setStepAiPrompt({});
      setStepAiTone({});
      setScoreResult(null);
    } catch (err: any) {
      alert(err?.response?.data?.error || "Failed to save campaign");
    } finally {
      setSaving(false);
    }
  };

  // ── Prebuilt template helpers ──────────────────────────────────────────────

  const useTemplate = (template: { name: string; steps: CampaignStep[] }) => {
    setBuilderName(template.name);
    setBuilderSteps(template.steps.map((s) => ({ ...s })));
    setStepAiPrompt({});
    setStepAiTone({});
    setScoreResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Edit campaign (inline) ─────────────────────────────────────────────────

  const openEdit = (c: Campaign) => {
    setEditId(c._id);
    setEditCampaign({ ...c, steps: c.steps.map((s) => ({ ...s })) });
  };

  const saveEdit = async () => {
    if (!editId || !editCampaign) return;
    setSaving(true);
    try {
      await axios.patch(`/api/email/campaigns/${editId}`, {
        name: editCampaign.name,
        steps: editCampaign.steps,
        dailyLimit: editCampaign.dailyLimit,
      });
      setCampaigns((prev) =>
        prev.map((c) => (c._id === editId ? { ...c, ...editCampaign } : c))
      );
      setEditId(null);
      setEditCampaign(null);
    } catch {
      alert("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 8) return "text-green-400";
    if (score >= 5) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="space-y-8">
      {/* ── A: Campaign List ── */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Your Email Campaigns</h2>
        {loading ? (
          <p className="text-gray-400 text-sm">Loading…</p>
        ) : campaigns.length === 0 ? (
          <p className="text-gray-500 text-sm">No email campaigns yet. Create one below.</p>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) =>
              editId === c._id && editCampaign ? (
                <div key={c._id} className="border border-blue-700 bg-[#1e293b] rounded-xl p-4 space-y-3">
                  <input
                    className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm w-full"
                    value={editCampaign.name}
                    onChange={(e) => setEditCampaign({ ...editCampaign, name: e.target.value })}
                    placeholder="Campaign name"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400">Daily limit</label>
                    <input
                      type="number"
                      className="bg-[#0f172a] border border-gray-600 rounded px-2 py-1 text-white text-sm w-20"
                      value={editCampaign.dailyLimit}
                      min={1}
                      onChange={(e) =>
                        setEditCampaign({ ...editCampaign, dailyLimit: Number(e.target.value) })
                      }
                    />
                  </div>
                  {editCampaign.steps.map((step, idx) => (
                    <div key={idx} className="border border-gray-700 rounded-lg p-3 space-y-2">
                      <p className="text-xs text-gray-400 font-medium">Step {idx + 1} — Day {step.day}</p>
                      <input
                        className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm w-full"
                        value={step.subject}
                        onChange={(e) =>
                          setEditCampaign({
                            ...editCampaign,
                            steps: editCampaign.steps.map((s, i) =>
                              i === idx ? { ...s, subject: e.target.value } : s
                            ),
                          })
                        }
                        placeholder="Subject"
                      />
                      <textarea
                        rows={3}
                        className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm w-full resize-none font-mono"
                        value={step.html}
                        onChange={(e) =>
                          setEditCampaign({
                            ...editCampaign,
                            steps: editCampaign.steps.map((s, i) =>
                              i === idx ? { ...s, html: e.target.value } : s
                            ),
                          })
                        }
                        placeholder="HTML body"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      onClick={saveEdit}
                      disabled={saving}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-60"
                    >
                      {saving ? "Saving…" : "Save Changes"}
                    </button>
                    <button
                      onClick={() => { setEditId(null); setEditCampaign(null); }}
                      className="text-gray-400 hover:text-white text-sm px-4 py-1.5 rounded border border-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div key={c._id} className="border border-gray-700 bg-[#1e293b] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-white font-medium">{c.name}</span>
                      <span className="text-gray-400 text-xs ml-2">
                        {c.steps.length} step{c.steps.length !== 1 ? "s" : ""} · {c.dailyLimit}/day
                      </span>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        c.isActive ? "bg-green-800 text-green-300" : "bg-gray-700 text-gray-400"
                      }`}
                    >
                      {c.isActive ? "Active" : "Paused"}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => openEdit(c)}
                      className="text-xs text-blue-400 hover:text-blue-300 border border-gray-600 px-3 py-1 rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => togglePause(c)}
                      className="text-xs text-yellow-400 hover:text-yellow-300 border border-gray-600 px-3 py-1 rounded"
                    >
                      {c.isActive ? "Pause" : "Resume"}
                    </button>
                    <button
                      onClick={() => deleteCampaign(c._id)}
                      className="text-xs text-red-400 hover:text-red-300 border border-gray-600 px-3 py-1 rounded"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </section>

      {/* ── B: Campaign Builder ── */}
      <section className="border border-gray-600 bg-[#1e293b] rounded-xl p-5 space-y-4">
        <h2 className="text-lg font-semibold text-white">Build New Campaign</h2>

        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs text-gray-400 mb-1 block">Campaign Name</label>
            <input
              value={builderName}
              onChange={(e) => setBuilderName(e.target.value)}
              placeholder="e.g. Spring Recruiting Push"
              className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Daily Limit</label>
            <input
              type="number"
              min={1}
              value={builderDailyLimit}
              onChange={(e) => setBuilderDailyLimit(Number(e.target.value))}
              className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm w-24"
            />
          </div>
        </div>

        {/* Steps */}
        {builderSteps.map((step, idx) => (
          <div key={idx} className="border border-gray-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">Step {idx + 1}</span>
              <button
                onClick={() => removeBuilderStep(idx)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            </div>

            {/* Day */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 whitespace-nowrap">Send on day</label>
              <input
                type="number"
                min={0}
                value={step.day}
                onChange={(e) => updateBuilderStep(idx, "day", Number(e.target.value))}
                className="bg-[#0f172a] border border-gray-600 rounded px-2 py-1 text-white text-sm w-20"
              />
            </div>

            {/* Subject */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Subject</label>
              <div className="flex gap-2">
                <input
                  value={step.subject}
                  onChange={(e) => updateBuilderStep(idx, "subject", e.target.value)}
                  placeholder="Email subject line"
                  className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm flex-1"
                />
                <button
                  onClick={() => scoreSubject(idx)}
                  disabled={scoringIdx === idx}
                  className="text-xs bg-[#0f172a] border border-gray-600 px-3 rounded text-gray-300 hover:text-white disabled:opacity-60 whitespace-nowrap"
                >
                  {scoringIdx === idx ? "Scoring…" : "Score"}
                </button>
              </div>
              {scoreResult && scoreResult.idx === idx && (
                <div className="mt-2 bg-[#0f172a] border border-gray-700 rounded-lg p-3 space-y-1.5">
                  <p className="text-sm">
                    Score:{" "}
                    <span className={`font-bold ${scoreColor(scoreResult.score)}`}>
                      {scoreResult.score}/10
                    </span>
                  </p>
                  <p className="text-xs text-gray-400">{scoreResult.feedback}</p>
                  {scoreResult.suggestions.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Alternatives:</p>
                      <ul className="space-y-1">
                        {scoreResult.suggestions.map((s, si) => (
                          <li key={si}>
                            <button
                              onClick={() => updateBuilderStep(idx, "subject", s)}
                              className="text-xs text-blue-400 hover:underline text-left"
                            >
                              {s}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* HTML Body */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">HTML Body</label>
              <textarea
                rows={4}
                value={step.html}
                onChange={(e) => updateBuilderStep(idx, "html", e.target.value)}
                placeholder="<p>Email body HTML…</p>"
                className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm w-full resize-y font-mono"
              />
            </div>

            {/* AI Generate row */}
            <div className="border-t border-gray-700 pt-3">
              <p className="text-xs text-gray-500 mb-2">AI Generate this step</p>
              <div className="flex gap-2 flex-wrap">
                <input
                  value={stepAiPrompt[idx] || ""}
                  onChange={(e) =>
                    setStepAiPrompt((prev) => ({ ...prev, [idx]: e.target.value }))
                  }
                  placeholder="e.g. Focus on Medicare Advantage carriers"
                  className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm flex-1 min-w-[160px]"
                />
                <select
                  value={stepAiTone[idx] || "professional"}
                  onChange={(e) =>
                    setStepAiTone((prev) => ({
                      ...prev,
                      [idx]: e.target.value as Tone,
                    }))
                  }
                  className="bg-[#0f172a] border border-gray-600 rounded px-2 py-1.5 text-white text-sm"
                >
                  {TONE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => generateStepContent(idx)}
                  disabled={stepGenerating[idx]}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-60 whitespace-nowrap"
                >
                  {stepGenerating[idx] ? "Generating…" : "Generate"}
                </button>
              </div>
            </div>
          </div>
        ))}

        <button
          onClick={addBuilderStep}
          className="text-sm text-blue-400 hover:text-blue-300 border border-gray-600 px-4 py-2 rounded"
        >
          + Add Step
        </button>

        <button
          onClick={saveBuilderCampaign}
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Campaign"}
        </button>
      </section>

      {/* ── C: Prebuilt Templates ── */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Prebuilt Templates</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PREBUILT_TEMPLATES.map((t) => (
            <div
              key={t.name}
              className="border border-gray-700 bg-[#1e293b] rounded-xl p-4 space-y-2"
            >
              <h3 className="text-white font-medium text-sm">{t.name}</h3>
              <p className="text-gray-400 text-xs">
                {t.steps.length} step{t.steps.length !== 1 ? "s" : ""}
              </p>
              <ul className="space-y-1">
                {t.steps.map((s, si) => (
                  <li key={si} className="text-xs text-gray-500">
                    Day {s.day}: {s.subject}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => useTemplate(t)}
                className="mt-1 text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded"
              >
                Use This Template
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
