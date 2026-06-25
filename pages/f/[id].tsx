// pages/f/[id].tsx
// Public hosted campaign funnel. Only safe campaign-owned fields are rendered.
import { useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import Head from "next/head";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";
import { getFunnelTemplate, FunnelStep } from "@/lib/facebook/funnels/funnelTemplates";
import { US_STATES, isStateAllowed, normalizeStateCode, stateLabel } from "@/lib/facebook/geo/usStates";
import { injectAgentContact } from "@/lib/funnels/injectAgentContact";
import {
  buildLeadGenerationConsentText,
  buildLeadGenerationSenderName,
} from "@/lib/a2p/flowSelection";

// ── Validation helpers ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalizeDigits = (v: string) => v.replace(/\D/g, "");

// ── Types ──────────────────────────────────────────────────────────────────────

type PublicAgentProfile = {
  displayName?: string;
  businessName?: string;
  phone?: string;
  stateLabel?: string;
  logoUrl?: string;
  headshotUrl?: string;
};

type ComplianceProfile = {
  disclaimerText?: string;
  consentText?: string;
  privacyUrl?: string;
  termsUrl?: string;
};

interface FunnelData {
  leadType: string;
  audienceSegment?: string;
  campaignType?: string;
  funnelVersion?: string;
  headline: string;
  subheadline: string;
  benefitBullets: string[];
  ctaStrip: string;
  imageUrl: string;
  publicAgentProfile?: PublicAgentProfile;
  complianceProfile?: ComplianceProfile;
  licensedStates: string[];
  borderStateBehavior: "allow_with_warning" | "block";
}

interface Props {
  campaignId: string;
  funnelData: FunnelData | null;
  webhookKey?: string;
  notFound?: boolean;
}

function getLeadTypeLabel(leadType: string, audienceSegment?: string): string {
  const compositeKey =
    audienceSegment && audienceSegment !== "standard"
      ? `${leadType}_${audienceSegment}`
      : leadType;
  const labels: Record<string, string> = {
    final_expense: "Final Expense",
    mortgage_protection: "Mortgage Protection",
    iul: "IUL",
    veteran: "Veteran Life Insurance",
    trucker: "Trucker Life Insurance",
    mortgage_protection_veteran: "Veteran Mortgage Protection",
    iul_veteran: "Veteran IUL",
    mortgage_protection_trucker: "Trucker Mortgage Protection",
    iul_trucker: "Trucker IUL",
  };
  return labels[compositeKey] || labels[leadType] || "Insurance";
}

function includesIdentity(text: string, value?: string): boolean {
  const needle = String(value || "").trim().toLowerCase();
  return !needle || text.toLowerCase().includes(needle);
}

function shouldUseStoredConsentText(text: string, agentName?: string, businessName?: string): boolean {
  const cleanText = text.trim();
  if (!cleanText) return false;
  return includesIdentity(cleanText, agentName) && includesIdentity(cleanText, businessName);
}

const DISCLAIMER_TEXT =
  "Availability varies by state and carrier. This is a no-obligation review with a licensed independent agent.";

const contactDefaults = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};
const contactFieldIds = ["firstName", "lastName", "email", "phone"] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function FunnelPage({ campaignId, funnelData, webhookKey = "", notFound }: Props) {
  const template = useMemo(
    () => getFunnelTemplate(funnelData?.leadType || "mortgage_protection", funnelData?.audienceSegment),
    [funnelData?.leadType, funnelData?.audienceSegment]
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [contact, setContact] = useState(contactDefaults);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState(false);
  const [smsConsentGiven, setSmsConsentGiven] = useState(false);

  const requiresOTP = funnelData?.campaignType === "hosted_funnel_otp";
  const [otpPhase, setOtpPhase] = useState<"phone" | "code" | "verified">(requiresOTP ? "phone" : "verified");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSessionId, setOtpSessionId] = useState("");
  const [otpVerifiedToken, setOtpVerifiedToken] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [otpExpiry, setOtpExpiry] = useState<Date | null>(null);

  if (notFound || !funnelData) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        <p>This page is no longer available.</p>
      </div>
    );
  }

  const sendOTP = async () => {
    setOtpLoading(true);
    setOtpError("");
    try {
      const r = await fetch("/api/funnel/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, phone: otpPhone }),
      });
      const data = await r.json();
      if (!r.ok) { setOtpError(data.error || "Failed to send code."); return; }
      setOtpSessionId(data.sessionId);
      setOtpExpiry(new Date(data.expiresAt));
      setOtpPhase("code");
    } catch {
      setOtpError("Network error. Please try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  const verifyOTP = async () => {
    setOtpLoading(true);
    setOtpError("");
    try {
      const r = await fetch("/api/funnel/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: otpSessionId, campaignId, phone: otpPhone, code: otpCode }),
      });
      const data = await r.json();
      if (!r.ok) { setOtpError(data.error || "Incorrect code."); return; }
      setOtpVerifiedToken(data.verifiedToken);
      setOtpPhase("verified");
    } catch {
      setOtpError("Network error. Please try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  if (requiresOTP && otpPhase !== "verified") {
    const otpTheme = template.theme;
    return (
      <main style={{ minHeight: "100vh", background: otpTheme.bg, fontFamily: "'Inter', system-ui, -apple-system, sans-serif", color: otpTheme.text, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
        <div style={{ maxWidth: 420, width: "100%", background: otpTheme.panel, border: "1px solid rgba(15,23,42,0.1)", borderRadius: 12, padding: "32px 28px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.06), 0 20px 50px -8px rgba(15,23,42,0.12)" }}>
          {otpPhase === "phone" ? (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px", color: otpTheme.text }}>Verify your phone number</h1>
              <p style={{ fontSize: 14, color: otpTheme.muted, margin: "0 0 20px" }}>We'll send a 6-digit code to confirm your number before submitting.</p>
              <input
                type="tel"
                placeholder="(555) 000-0000"
                value={otpPhone}
                onChange={(e) => setOtpPhone(formatPhoneDisplay(e.target.value))}
                style={{ width: "100%", padding: "13px 14px", borderRadius: 8, fontSize: 15, border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a", outline: "none", boxSizing: "border-box", fontFamily: "inherit", appearance: "none", WebkitAppearance: "none" }}
              />
              {otpError && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 10 }}>{otpError}</p>}
              <button
                onClick={sendOTP}
                disabled={otpLoading || otpPhone.replace(/\D/g, "").length < 10}
                style={{ width: "100%", marginTop: 16, padding: "15px 16px", borderRadius: 8, border: "none", background: otpTheme.button, color: otpTheme.buttonText, fontSize: 16, fontWeight: 800, cursor: "pointer", opacity: otpLoading ? 0.7 : 1 }}
              >
                {otpLoading ? "Sending…" : "Send Code"}
              </button>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px", color: otpTheme.text }}>Enter your code</h1>
              <p style={{ fontSize: 14, color: otpTheme.muted, margin: "0 0 20px" }}>
                We sent a 6-digit code to {otpPhone}.{otpExpiry ? ` Expires at ${otpExpiry.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : ""}
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="123456"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                style={{ width: "100%", padding: "13px 14px", borderRadius: 8, fontSize: 22, letterSpacing: "0.2em", textAlign: "center", border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a", outline: "none", boxSizing: "border-box", fontFamily: "inherit", appearance: "none", WebkitAppearance: "none" }}
              />
              {otpError && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 10 }}>{otpError}</p>}
              <button
                onClick={verifyOTP}
                disabled={otpLoading || otpCode.length < 6}
                style={{ width: "100%", marginTop: 16, padding: "15px 16px", borderRadius: 8, border: "none", background: otpTheme.button, color: otpTheme.buttonText, fontSize: 16, fontWeight: 800, cursor: "pointer", opacity: otpLoading ? 0.7 : 1 }}
              >
                {otpLoading ? "Verifying…" : "Verify Code"}
              </button>
              <button
                onClick={() => { setOtpPhase("phone"); setOtpCode(""); setOtpError(""); }}
                style={{ width: "100%", marginTop: 10, padding: "10px 16px", borderRadius: 8, border: "none", background: "transparent", color: otpTheme.muted, fontSize: 14, cursor: "pointer" }}
              >
                Use a different number
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  const theme = template.theme;
  const steps = template.steps;
  const currentStep = steps[stepIndex];
  const selectedState = normalizeStateCode(answers.state);
  const blockedState =
    !!selectedState &&
    !isStateAllowed(selectedState, funnelData.licensedStates) &&
    funnelData.borderStateBehavior === "block";

  // ── Per-step validation ─────────────────────────────────────────────────────
  // Returns error string or "" when valid. `override` lets choice/contact handlers
  // pass the just-selected value without waiting on a React state flush.
  const getStepError = (step: FunnelStep, override?: string): string => {
    if (!step) return "";
    if (step.id === "consent") return "";

    if (step.type === "contact") {
      if (contact.firstName.trim().length < 2) return "Please enter your first name.";
      if (contact.lastName.trim().length < 2) return "Please enter your last name.";
      if (normalizeDigits(contact.phone).length < 10) return "Please enter a valid phone number (10 digits).";
      return "";
    }

    const rawVal =
      override !== undefined
        ? override
        : contactFieldIds.includes(step.id as any)
          ? String(contact[step.id as keyof typeof contact] || "")
          : String(answers[step.id] || "");
    const val = rawVal.trim();

    if (!step.required) return "";
    if (!val) return "Please answer this question to continue.";

    if (step.id === "email" || step.type === "email") {
      if (!EMAIL_RE.test(val)) return "Please enter a valid email address (e.g. name@example.com).";
    }
    if (step.id === "phone" || step.type === "tel") {
      if (normalizeDigits(val).length < 10) return "Please enter a valid phone number (at least 10 digits).";
    }
    if ((step.id === "firstName" || step.id === "lastName") && val.length < 2) {
      return "Please enter at least 2 characters.";
    }
    return "";
  };

  // ── Navigation ──────────────────────────────────────────────────────────────
  // `immediateAnswer` lets choice steps pass the just-clicked value before React
  // commits the state update, preventing false "Please answer" errors.
  const next = async (immediateAnswer?: string) => {
    setSubmitError("");

    const err = getStepError(currentStep, immediateAnswer);
    if (err) {
      setSubmitError(err);
      return;
    }
    if (currentStep?.id === "state" && blockedState) {
      setSubmitError("We currently do not service your state for this campaign.");
      return;
    }
    if (stepIndex < steps.length - 1) {
      setStepIndex(stepIndex + 1);
      return;
    }
    await submit();
  };

  const submit = async () => {
    if (blockedState) {
      setSubmitError("We currently do not service your state for this campaign.");
      return;
    }
    const finalAnswers = {
      ...answers,
      smsConsentGiven: smsConsentGiven ? "yes" : "no",
      smsConsentText: smsConsentLabel,
    };
    setSubmitting(true);
    setSubmitError("");
    try {
      const r = await fetch(`/api/facebook/funnel-submit?key=${encodeURIComponent(webhookKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          state: selectedState || answers.state,
          age: answers.age,
          selectedOption: answers.coverage || answers.mortgageAmount || "",
          smsConsentGiven,
          smsConsentText: smsConsentLabel,
          answers: finalAnswers,
          stateRestrictionWarning: false,
          stateOutsidePrimaryLicensedArea: false,
          ...(otpVerifiedToken ? { verifiedToken: otpVerifiedToken } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setSubmitError(data.error || "Submission failed. Please try again.");
        return;
      }
      setDone(true);
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const setAnswer = (id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    // Clear error immediately when the user provides any input
    setSubmitError("");
  };

  // ── Step renderer ───────────────────────────────────────────────────────────

  const agent = funnelData.publicAgentProfile || {};
  const agentName = agent.displayName?.trim() || "";
  const businessName = agent.businessName?.trim() || "";
  const consentSenderName = buildLeadGenerationSenderName({ agentName, businessName });
  const leadTypeLabel = getLeadTypeLabel(funnelData.leadType, funnelData.audienceSegment);
  const dynamicConsentText = buildLeadGenerationConsentText({
    agentName,
    businessName,
    campaignType: funnelData.leadType,
  });
  const isA2PComplianceStub = funnelData.funnelVersion === "a2p-compliance-stub";

  const smsConsentLabel = isA2PComplianceStub
    ? `Yes, I agree to receive SMS messages from ${consentSenderName} about my ${leadTypeLabel} request. Messages may include quote discussions, appointment scheduling, application follow-up, customer support, and responses to my inquiry. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not required to submit this request or purchase any product.`
    : `Yes, I agree to receive SMS messages from ${consentSenderName} about my ${leadTypeLabel} request. Messages may include quote discussions, appointment scheduling, application follow-up, customer support, and responses to my inquiry. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. I also agree that a licensed agent may contact me at the phone number I provide via telephone calls, including calls made using artificial or prerecorded voice and AI-assisted voice technology. By checking this box and submitting this form, I agree to the communications described above.`;

  const storedConsentText = funnelData.complianceProfile?.consentText?.trim() || "";
  const consentText =
    shouldUseStoredConsentText(storedConsentText, agentName, businessName) ? storedConsentText : dynamicConsentText;

  const renderStep = (step: FunnelStep) => {
    // ── Consent step: show full TCPA text + single submit button ────────────
    if (step.id === "consent") {
      return (
        <div>
          <label style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            border: "1px solid rgba(15,23,42,0.14)",
            borderRadius: 8,
            padding: "14px 16px",
            marginBottom: 16,
            cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={smsConsentGiven}
              onChange={(e) => {
                const checked = e.target.checked;
                setSmsConsentGiven(checked);
                setAnswer(step.id, checked ? "Yes, I agree" : "No SMS consent");
              }}
              style={{
                width: 18,
                height: 18,
                marginTop: 2,
                flexShrink: 0,
                accentColor: theme.button,
                cursor: "pointer",
              }}
            />
            <span style={{ fontSize: 12, lineHeight: 1.55, color: theme.text }}>
              {smsConsentLabel}
            </span>
          </label>
          {isA2PComplianceStub && (
            <p style={{ margin: "0 0 16px", fontSize: 11, color: theme.muted, lineHeight: 1.5 }}>
              SMS consent is optional. You may submit your request without checking this box.
            </p>
          )}
          <button
            onClick={() => {
              next(smsConsentGiven ? "Yes, I agree" : "No SMS consent");
            }}
            disabled={submitting || (!isA2PComplianceStub && !smsConsentGiven)}
            style={{
              ...choiceButtonStyle(theme, false),
              width: "100%",
              background: theme.button,
              color: theme.buttonText,
              border: `1px solid ${theme.button}`,
              fontWeight: 800,
              fontSize: 16,
              padding: "16px 20px",
              opacity: submitting || (!isA2PComplianceStub && !smsConsentGiven) ? 0.7 : 1,
              cursor: submitting ? "wait" : !isA2PComplianceStub && !smsConsentGiven ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Submitting…" : "Submit Request"}
          </button>
        </div>
      );
    }

    // ── Contact step (combined) ──────────────────────────────────────────────
    if (step.type === "contact") {
      return (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input
              placeholder="First Name"
              value={contact.firstName}
              onChange={(e) => {
                setContact({ ...contact, firstName: e.target.value });
                setSubmitError("");
              }}
              style={inputStyle}
            />
            <input
              placeholder="Last Name"
              value={contact.lastName}
              onChange={(e) => {
                setContact({ ...contact, lastName: e.target.value });
                setSubmitError("");
              }}
              style={inputStyle}
            />
          </div>
          <input
            placeholder="Phone Number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={contact.phone}
            onChange={(e) => {
              const formatted = formatPhoneDisplay(e.target.value);
              setContact({ ...contact, phone: formatted });
              setAnswer("phone", formatted);
              setSubmitError("");
            }}
            style={inputStyle}
          />
          <input
            placeholder="Email Address (optional)"
            type="email"
            value={contact.email}
            onChange={(e) => {
              setContact({ ...contact, email: e.target.value });
              setSubmitError("");
            }}
            style={inputStyle}
          />
        </div>
      );
    }

    // ── Choice step ──────────────────────────────────────────────────────────
    if (step.type === "choice") {
      return (
        <div style={{ display: "grid", gap: 10 }}>
          {step.options.map((option) => {
            const selected = answers[step.id] === option;
            return (
              <button
                key={option}
                onClick={() => {
                  setAnswer(step.id, option);
                  // Pass the value directly — avoids stale-closure false errors
                  next(option);
                }}
                style={choiceButtonStyle(theme, selected)}
              >
                {option}
              </button>
            );
          })}
        </div>
      );
    }

    // ── State select ─────────────────────────────────────────────────────────
    if (step.type === "state") {
      return (
        <div style={{ position: "relative" }}>
          <select
            value={answers[step.id] || ""}
            onChange={(e) => setAnswer(step.id, e.target.value)}
            style={selectStyle}
          >
            <option value="">Select your state</option>
            {US_STATES.map((state) => (
              <option key={state.code} value={state.code}>{state.name}</option>
            ))}
          </select>
          {/* Custom dropdown arrow — prevents invisible arrow on Safari */}
          <span style={{
            position: "absolute",
            right: 14,
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
            color: "#6b7280",
            fontSize: 14,
          }}>▼</span>
        </div>
      );
    }

    // ── Text / email / tel / number / date input ─────────────────────────────
    const contactField = contactFieldIds.includes(step.id as any)
      ? (step.id as keyof typeof contact)
      : null;

    const isTel = step.type === "tel" || step.id === "phone";
    return (
      <input
        placeholder={step.placeholder || step.title}
        type={step.type}
        value={contactField ? contact[contactField] : answers[step.id] || ""}
        onChange={(e) => {
          const raw = e.target.value;
          const val = isTel ? formatPhoneDisplay(raw) : raw;
          if (contactField) {
            setContact((prev) => ({ ...prev, [contactField]: val }));
          }
          setAnswer(step.id, val);
        }}
        style={inputStyle}
        autoComplete={
          step.id === "firstName" ? "given-name"
          : step.id === "lastName" ? "family-name"
          : step.id === "email" ? "email"
          : step.id === "phone" ? "tel"
          : "off"
        }
        inputMode={isTel ? "tel" : step.type === "number" ? "numeric" : step.type === "email" ? "email" : undefined}
      />
    );
  };

  const inputStyle = getInputStyle(theme);
  const selectStyle = getSelectStyle(theme);

  const agentPhoneDigits = normalizeDigits(agent.phone || "");
  const agentTel = agentPhoneDigits.length >= 10 ? `tel:+1${agentPhoneDigits.slice(-10)}` : "";
  const compliance = funnelData.complianceProfile || {};
  const isConsentStep = currentStep?.id === "consent";
  const isChoiceStep = currentStep?.type === "choice";

  return (
    <>
      <Head>
        <title>{funnelData.headline || template.defaultHeadline}</title>
        <meta name="robots" content="noindex" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      <main style={{ minHeight: "100vh", background: theme.bg, fontFamily: "'Inter', system-ui, -apple-system, sans-serif", color: theme.text }}>
        {funnelData.imageUrl && (
          <div style={{ width: "100%", maxHeight: 260, overflow: "hidden" }}>
            <img src={funnelData.imageUrl} alt="" style={{ width: "100%", height: 260, objectFit: "cover", display: "block" }} />
          </div>
        )}

        <section style={{ maxWidth: 540, margin: "0 auto", padding: "28px 18px 64px" }}>
          {/* Agent / brand strip */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            {(agent.logoUrl || agent.headshotUrl) ? (
              <img
                src={agent.logoUrl || agent.headshotUrl}
                alt=""
                style={{ width: 42, height: 42, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
              />
            ) : null}
            <div>
              <p style={{ margin: 0, fontSize: 11, color: theme.accent, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {template.eyebrow}
              </p>
              {(businessName || agentName) && (
                <p style={{ margin: "2px 0 0", fontSize: 13, color: theme.muted }}>
                  {[agentName, businessName].filter(Boolean).join(" • ")}
                </p>
              )}
            </div>
          </div>

          {!done ? (
            <div style={{
              background: theme.panel,
              border: "1px solid rgba(15,23,42,0.1)",
              borderRadius: 12,
              padding: "26px 24px",
              boxShadow: "0 4px 6px -1px rgba(0,0,0,0.06), 0 20px 50px -8px rgba(15,23,42,0.12)",
            }}>
              {/* Progress */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                <div style={{
                  flex: 1,
                  height: 4,
                  background: "rgba(15,23,42,0.08)",
                  borderRadius: 4,
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${((stepIndex + 1) / steps.length) * 100}%`,
                    background: theme.accent,
                    borderRadius: 4,
                    transition: "width 0.3s ease",
                  }} />
                </div>
                <span style={{ fontSize: 11, color: theme.muted, flexShrink: 0, fontWeight: 600 }}>
                  {stepIndex + 1} / {steps.length}
                </span>
              </div>

              {/* Headline */}
              <h1 style={{ fontSize: 24, lineHeight: 1.2, margin: "0 0 8px", color: theme.text, fontWeight: 800 }}>
                {stepIndex === 0 ? (funnelData.headline || template.defaultHeadline) : currentStep.title}
              </h1>
              <p style={{ fontSize: 14, color: theme.muted, lineHeight: 1.55, margin: "0 0 20px" }}>
                {stepIndex === 0
                  ? (funnelData.subheadline || template.defaultSubheadline)
                  : (currentStep.subtitle || (stepIndex === 0 ? template.defaultSubheadline : ""))}
              </p>

              {/* First-step reassurance bullets */}
              {stepIndex === 0 && template.reassurance.length > 0 && (
                <div style={{ display: "grid", gap: 6, marginBottom: 18 }}>
                  {template.reassurance.map((item) => (
                    <div key={item} style={{ fontSize: 13, color: theme.muted, display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <span style={{ color: theme.accent, fontWeight: 700, flexShrink: 0 }}>✓</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Step content */}
              {renderStep(currentStep)}

              {/* Blocked state error (hard block — no soft warning shown) */}
              {blockedState && (
                <p style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginTop: 14 }}>
                  We currently do not service {stateLabel(selectedState)} for this campaign.
                </p>
              )}

              {/* Validation / submit error */}
              {submitError && (
                <p style={{ color: "#dc2626", fontSize: 13, marginTop: 12, fontWeight: 500 }}>
                  {submitError}
                </p>
              )}

              {/* Continue / Submit button — hidden for choice steps (they auto-advance) */}
              {!isChoiceStep && !isConsentStep && (
                <button
                  onClick={() => next()}
                  disabled={submitting || blockedState}
                  style={{
                    width: "100%",
                    marginTop: 18,
                    padding: "15px 16px",
                    borderRadius: 8,
                    border: "none",
                    background: theme.button,
                    color: theme.buttonText,
                    fontSize: 16,
                    fontWeight: 800,
                    cursor: submitting || blockedState ? "not-allowed" : "pointer",
                    opacity: submitting || blockedState ? 0.65 : 1,
                    letterSpacing: "0.01em",
                  }}
                >
                  {submitting ? "Submitting…" : stepIndex === steps.length - 1 ? "Submit Request" : "Continue →"}
                </button>
              )}

              {/* Back link */}
              {stepIndex > 0 && (
                <button
                  onClick={() => { setStepIndex(stepIndex - 1); setSubmitError(""); }}
                  style={{ marginTop: 12, background: "transparent", border: "none", color: theme.muted, cursor: "pointer", fontSize: 13, padding: "4px 0" }}
                >
                  ← Back
                </button>
              )}

            </div>
          ) : (
            <div style={{
              background: theme.panel,
              borderRadius: 12,
              padding: "36px 28px",
              textAlign: "center",
              border: "1px solid rgba(15,23,42,0.1)",
              boxShadow: "0 4px 6px -1px rgba(0,0,0,0.06), 0 20px 50px -8px rgba(15,23,42,0.12)",
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <h1 style={{ color: theme.text, fontSize: 24, marginBottom: 10, fontWeight: 800 }}>You&apos;re all set.</h1>
              <p style={{ color: theme.muted, lineHeight: 1.6, fontSize: 15 }}>
                A licensed agent will review your request and reach out shortly.
              </p>
              {agentTel && (
                <div style={{ marginTop: 22 }}>
                  <p style={{ color: theme.text, fontSize: 16, fontWeight: 800, margin: "0 0 10px" }}>
                    Want to speak to someone now?
                  </p>
                  <a
                    href={agentTel}
                    style={{
                      display: "inline-block",
                      padding: "14px 18px",
                      borderRadius: 8,
                      background: theme.button,
                      color: theme.buttonText,
                      textDecoration: "none",
                      fontWeight: 800,
                      fontSize: 15,
                    }}
                  >
                    CALL NOW
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Footer disclaimer */}
          <p style={{ marginTop: 20, fontSize: 11, color: theme.muted, lineHeight: 1.5, textAlign: "center", opacity: 0.7 }}>
            {compliance.disclaimerText?.trim() || DISCLAIMER_TEXT}
          </p>
          {(compliance.privacyUrl || compliance.termsUrl) && (
            <p style={{ textAlign: "center", fontSize: 11, marginTop: 4 }}>
              {compliance.privacyUrl && <a href={compliance.privacyUrl} style={{ color: theme.accent }}>Privacy Policy</a>}
              {compliance.privacyUrl && compliance.termsUrl ? " · " : ""}
              {compliance.termsUrl && <a href={compliance.termsUrl} style={{ color: theme.accent }}>Terms</a>}
            </p>
          )}
        </section>
      </main>
    </>
  );
}

// ── Theme utilities ───────────────────────────────────────────────────────────

// Returns true when the funnel background is perceptually dark (final_expense et al.)
function isDarkTheme(bg: string): boolean {
  if (!bg || bg.length < 7) return false;
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

// Auto-formats a phone string to (XXX) XXX-XXXX as the user types.
export function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

type FunnelTheme = {
  bg: string;
  accent: string;
  button: string;
  buttonText: string;
  text: string;
};

// Theme-aware input style: dark funnels get a subtle dark-glass input;
// light funnels get a clean white input. WebkitTextFillColor fixes invisible
// text on Safari which ignores `color` on some form control states.
function getInputStyle(theme: FunnelTheme): React.CSSProperties {
  const dark = isDarkTheme(theme.bg);
  return {
    width: "100%",
    padding: "13px 14px",
    borderRadius: 8,
    fontSize: 15,
    border: dark ? "1.5px solid rgba(255,255,255,0.18)" : "1px solid #cbd5e1",
    background: dark ? "rgba(255,255,255,0.07)" : "#ffffff",
    color: theme.text,
    WebkitTextFillColor: theme.text,
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
    appearance: "none",
    WebkitAppearance: "none",
  };
}

function getSelectStyle(theme: FunnelTheme): React.CSSProperties {
  return {
    ...getInputStyle(theme),
    paddingRight: 38,
    cursor: "pointer",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
  };
}

function choiceButtonStyle(theme: FunnelTheme, selected: boolean): React.CSSProperties {
  const dark = isDarkTheme(theme.bg);
  return {
    border: `1.5px solid ${selected ? theme.accent : dark ? "rgba(255,255,255,0.2)" : "#d1d5db"}`,
    background: selected ? theme.button : dark ? "rgba(255,255,255,0.06)" : "#ffffff",
    color: selected ? theme.buttonText : theme.text,
    WebkitTextFillColor: selected ? theme.buttonText : theme.text,
    padding: "14px 16px",
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 15,
    textAlign: "left",
    cursor: "pointer",
    width: "100%",
    display: "block",
    transition: "border-color 0.15s, background 0.15s",
    fontFamily: "inherit",
  };
}

// ── Server-side data fetching ─────────────────────────────────────────────────

export const getServerSideProps: GetServerSideProps = async (context) => {
  const id = String(context.params?.id || "");

  try {
    await mongooseConnect();
    const campaign = await (FBLeadCampaign as any).findById(id)
      .select("userId leadType audienceSegment campaignType funnelVersion notes webhookKey funnelStatus landingPageConfig publicAgentProfile complianceProfile licensedStates borderStateBehavior")
      .lean() as any;

    if (!campaign || campaign.funnelStatus === "paused") {
      return { props: { campaignId: id, funnelData: null, notFound: true } };
    }

    let webhookKey = String(campaign.webhookKey || "");
    if (!webhookKey) {
      webhookKey = Math.random().toString(36).substring(2, 12);
      await (FBLeadCampaign as any).updateOne({ _id: id }, { $set: { webhookKey } });
    }

    let notesFunnelData: any = null;
    try {
      const notes = JSON.parse(campaign.notes || "{}");
      notesFunnelData = notes.funnelData || null;
    } catch {}

    const safeConfig = campaign.landingPageConfig && Object.keys(campaign.landingPageConfig).length
      ? campaign.landingPageConfig
      : notesFunnelData;
    const template = getFunnelTemplate(String(campaign.leadType || "mortgage_protection"), String(campaign.audienceSegment || ""));
    const crmUser = campaign.userId
      ? await (User as any).findById(campaign.userId)
          .select("email name firstName lastName agentPhone numbers")
          .lean()
      : null;
    const agentContact = injectAgentContact(crmUser, {
      name: campaign.publicAgentProfile?.displayName,
      phone: campaign.publicAgentProfile?.phone,
      email: crmUser?.email,
    });

    const funnelData: FunnelData = {
      leadType: String(campaign.leadType || "mortgage_protection"),
      audienceSegment: String(campaign.audienceSegment || "standard"),
      campaignType: String(campaign.campaignType || "hosted_funnel"),
      funnelVersion: String(campaign.funnelVersion || ""),
      headline: String(safeConfig?.headline || safeConfig?.adHeadline || template.defaultHeadline),
      subheadline: String(safeConfig?.subheadline || template.defaultSubheadline),
      benefitBullets: Array.isArray(safeConfig?.benefitBullets) ? safeConfig.benefitBullets.map(String).slice(0, 4) : [],
      ctaStrip: String(safeConfig?.ctaStrip || "Submit Request"),
      imageUrl: String(safeConfig?.imageUrl || ""),
      publicAgentProfile: {
        displayName: agentContact.name,
        businessName: String(campaign.publicAgentProfile?.businessName || ""),
        phone: agentContact.phone,
        stateLabel: String(campaign.publicAgentProfile?.stateLabel || ""),
        logoUrl: String(campaign.publicAgentProfile?.logoUrl || ""),
        headshotUrl: String(campaign.publicAgentProfile?.headshotUrl || ""),
      },
      complianceProfile: {
        disclaimerText: String(campaign.complianceProfile?.disclaimerText || ""),
        consentText: String(campaign.complianceProfile?.consentText || ""),
        privacyUrl: String(campaign.complianceProfile?.privacyUrl || ""),
        termsUrl: String(campaign.complianceProfile?.termsUrl || ""),
      },
      licensedStates: Array.isArray(campaign.licensedStates) ? campaign.licensedStates.map(String) : [],
      borderStateBehavior: campaign.borderStateBehavior === "allow_with_warning" ? "allow_with_warning" : "block",
    };

    return { props: { campaignId: id, funnelData, webhookKey } };
  } catch (err: any) {
    console.error("[funnel page] error:", err?.message);
    return { props: { campaignId: id, funnelData: null, notFound: true } };
  }
};
