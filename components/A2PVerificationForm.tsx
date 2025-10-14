// components/A2PVerificationForm.tsx
import { useState } from "react";
import toast from "react-hot-toast";

type UploadedFileResponse = { url: string; message?: string };

// Twilio A2P use-case codes we support
type UseCaseCode =
  | "MIXED"
  | "LOW_VOLUME"
  | "MARKETING"
  | "2FA"
  | "ACCOUNT_NOTIFICATION"
  | "CUSTOMER_CARE"
  | "DELIVERY_NOTIFICATION"
  | "FRAUD_ALERT"
  | "HIGHER_EDUCATION"
  | "POLLING_VOTING"
  | "PUBLIC_SERVICE_ANNOUNCEMENT"
  | "SECURITY_ALERT"
  | "AGENTS_FRANCHISES"
  | "CHARITY"
  | "K12_EDUCATION"
  | "PROXY"
  | "EMERGENCY";

const COMMON_USECASES: { value: UseCaseCode; label: string }[] = [
  { value: "MIXED", label: "Mixed (most used)" },
  { value: "LOW_VOLUME", label: "Low Volume (mixed)" },
  { value: "MARKETING", label: "Marketing / Promotions" },
  { value: "CUSTOMER_CARE", label: "Customer Care / Support" },
  { value: "ACCOUNT_NOTIFICATION", label: "Account Notifications" },
  { value: "2FA", label: "2FA / OTP" },
];

const ADVANCED_USECASES: { value: UseCaseCode; label: string }[] = [
  { value: "DELIVERY_NOTIFICATION", label: "Delivery Notifications" },
  { value: "FRAUD_ALERT", label: "Fraud / Spend Alerts" },
  { value: "HIGHER_EDUCATION", label: "Higher Education" },
  { value: "POLLING_VOTING", label: "Polling / Voting (non-political)" },
  { value: "PUBLIC_SERVICE_ANNOUNCEMENT", label: "Public Service Announcement" },
  { value: "SECURITY_ALERT", label: "Security Alerts" },
  { value: "AGENTS_FRANCHISES", label: "Agents / Franchises (special)" },
  { value: "CHARITY", label: "Charity 501(c)(3) (special)" },
  { value: "K12_EDUCATION", label: "K-12 Education (special)" },
  { value: "PROXY", label: "Proxy / P2P App (special)" },
  { value: "EMERGENCY", label: "Emergency (special)" },
];

export default function A2PVerificationForm() {
  // ---------- Business ----------
  const [businessName, setBusinessName] = useState("");
  const [ein, setEin] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // ---------- Explicit link fields ----------
  const [landingOptInUrl, setLandingOptInUrl] = useState(""); // required
  const [landingTosUrl, setLandingTosUrl] = useState(""); // optional (recommended)
  const [landingPrivacyUrl, setLandingPrivacyUrl] = useState(""); // optional (recommended)

  // ---------- Contact ----------
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactTitle, setContactTitle] = useState("");

  // ---------- Sample Messages (separate boxes) ----------
  const [msg1, setMsg1] = useState(
    `Hi {{first_name}}, it’s {{agent_name}} from our insurance team. You requested info on your life insurance options – when’s a good time for a quick call? Reply STOP to opt out.`
  );
  const [msg2, setMsg2] = useState(
    `Hi {{first_name}}, you’re pre-approved for benefits this week through the program you opted into. Want to review options now or later today? Reply STOP to unsubscribe.`
  );
  const [msg3, setMsg3] = useState(
    `Hi {{first_name}}, just following up from your Facebook request for a life insurance quote. This is {{agent_name}} – can I call you real quick? Reply STOP to opt out.`
  );

  // ---------- Opt-in Details ----------
  const [optInDetails, setOptInDetails] = useState(
    `End users opt in by submitting their contact information through a TCPA-compliant lead form hosted on a vendor or agency landing page. The form collects full name, email, and phone number, and includes an electronic signature agreement directly above the “Confirm” button.

Before submission, users see a disclosure similar to:

“By entering your name and information above and clicking this button, you are consenting to receive calls or emails regarding your life insurance options (at any phone number or email address you provide) from a licensed insurance agent or one of our business partners. You agree such calls may use an automatic telephone dialing system or a prerecorded voice to deliver messages even if you are on a government do-not-call registry. This agreement is not a condition of enrollment.”

The form uses click-wrap consent and displays Privacy Policy and Terms & Conditions links on the same page as the form submission. This campaign is exclusive to me. Leads are never resold, reused, or shared with other agents or organizations. Vendors maintain timestamped proof of consent, IP address, and full submission metadata to ensure compliance.`
  );

  // ---------- Volume + screenshot ----------
  const [volume, setVolume] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [optInScreenshotUrl, setOptInScreenshotUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ---------- Campaign Type ----------
  const [useCase, setUseCase] = useState<UseCaseCode>("MIXED");

  // ---------- Helpers ----------
  const allMessages = [msg1, msg2, msg3].filter(Boolean).join("\n\n");

  const ensureHasStopLanguage = (text: string) =>
    /reply\s+stop/i.test(text) || /text\s+stop/i.test(text);

  // Required fields: TOS & Privacy are optional (recommended)
  const requiredOk = () =>
    businessName &&
    ein &&
    address &&
    website &&
    email &&
    phone &&
    landingOptInUrl &&
    contactFirstName &&
    contactLastName &&
    msg1 &&
    msg2 &&
    msg3 &&
    optInDetails &&
    volume &&
    optInScreenshotUrl;

  // ---------- Upload ----------
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error("❌ Please select a screenshot file first");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/uploadOptIn", { method: "POST", body: formData });
      const data: UploadedFileResponse = await res.json();

      if (!res.ok) {
        toast.error(`❌ Upload failed: ${data.message || res.statusText}`);
        return;
      }

      setOptInScreenshotUrl(data.url);
      toast.success("✅ Screenshot uploaded");
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("❌ Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // ---------- Submit ----------
  const handleSubmit = async () => {
    if (!requiredOk()) {
      toast.error("❌ Please complete all required fields and upload a screenshot");
      return;
    }

    if (![msg1, msg2, msg3].every(ensureHasStopLanguage)) {
      toast.error('❌ Each sample message must include opt-out language (e.g., “Reply STOP to opt out”).');
      return;
    }

    setSubmitting(true);
    try {
      // 0) Back-compat: keep your existing endpoint
      const legacyRes = await fetch("/api/registerA2P", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          ein,
          address,
          website,
          email,
          phone,
          contactFirstName,
          contactLastName,
          contactTitle,

          sampleMessages: allMessages,   // blob for old API
          sampleMessage1: msg1,
          sampleMessage2: msg2,
          sampleMessage3: msg3,

          optInDetails,
          volume,
          optInScreenshotUrl,

          // explicit links (old API may ignore; fine)
          landingOptInUrl,
          landingTosUrl,
          landingPrivacyUrl,
        }),
      });
      const legacyData = await legacyRes.json().catch(() => ({}));
      if (!legacyRes.ok) throw new Error(legacyData.message || "Legacy submit failed");

      // 1) New flow: create/ensure TrustHub + Brand + Messaging Service
      const startRes = await fetch("/api/a2p/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          ein,
          website,
          address,
          email,
          phone,
          contactTitle,
          contactFirstName,
          contactLastName,
          sampleMessages: [msg1, msg2, msg3],
          optInDetails,
          volume,
          optInScreenshotUrl,
          // helpful metadata for reviewers
          landingPageUrl: landingOptInUrl,
          termsUrl: landingTosUrl,
          privacyUrl: landingPrivacyUrl,
          usecaseCode: useCase,
        }),
      });
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok) throw new Error(startData.message || "Failed to start A2P");

      // 2) Submit/Update Campaign with selected use case
      const hasLinks =
        !!landingOptInUrl ||
        [msg1, msg2, msg3].some((s) => /\bhttps?:\/\//i.test(s));

      const campRes = await fetch("/api/a2p/submit-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          useCase,
          messageFlow: optInDetails,
          sampleMessages: [msg1, msg2, msg3],
          hasEmbeddedLinks: hasLinks,
          hasEmbeddedPhone: false,
          subscriberOptIn: true,
          ageGated: false,
          directLending: false,
        }),
      });
      const campData = await campRes.json().catch(() => ({}));
      if (!campRes.ok) throw new Error(campData.message || "Failed to submit campaign");

      toast.success("✅ Submitted! We’ll notify you when A2P is approved or if updates are needed.");
    } catch (err: any) {
      console.error("Submission error:", err);
      toast.error(`❌ ${err?.message || "Error submitting verification"}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- UI ----------
  return (
    <div className="border border-black dark:border-white p-4 rounded space-y-4">
      <h2 className="text-xl font-bold">A2P Brand Verification</h2>

      {/* Business */}
      <input
        type="text"
        placeholder="Business Name"
        value={businessName}
        onChange={(e) => setBusinessName(e.target.value)}
        className="border p-2 rounded w-full"
      />
      <input
        type="text"
        placeholder="EIN or Tax ID"
        value={ein}
        onChange={(e) => setEin(e.target.value)}
        className="border p-2 rounded w-full"
      />
      <input
        type="text"
        placeholder="Business Address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        className="border p-2 rounded w-full"
      />
      <input
        type="url"
        placeholder="Website URL"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="border p-2 rounded w-full"
      />
      <input
        type="email"
        placeholder="Business Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border p-2 rounded w-full"
      />
      <input
        type="text"
        placeholder="Business Phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="border p-2 rounded w-full"
      />

      {/* Links (prominent) */}
      <div className="grid md:grid-cols-2 gap-3">
        <input
          type="url"
          placeholder="Landing Page URL (with opt-in language)"
          value={landingOptInUrl}
          onChange={(e) => setLandingOptInUrl(e.target.value)}
          className="border p-2 rounded w-full"
        />
        <input
          type="url"
          placeholder="Terms of Service URL (optional)"
          value={landingTosUrl}
          onChange={(e) => setLandingTosUrl(e.target.value)}
          className="border p-2 rounded w-full"
        />
        <input
          type="url"
          placeholder="Privacy Policy URL (optional)"
          value={landingPrivacyUrl}
          onChange={(e) => setLandingPrivacyUrl(e.target.value)}
          className="border p-2 rounded w-full md:col-span-2"
        />
      </div>
      <p className="text-xs text-gray-500 -mt-2">
        <span className="font-medium">Note:</span> Terms of Service and Privacy Policy links are
        optional but strongly recommended. Your landing page URL is required and should show the opt-in language.
      </p>

      {/* Contact */}
      <input
        type="text"
        placeholder="Contact First Name"
        value={contactFirstName}
        onChange={(e) => setContactFirstName(e.target.value)}
        className="border p-2 rounded w-full"
      />
      <input
        type="text"
        placeholder="Contact Last Name"
        value={contactLastName}
        onChange={(e) => setContactLastName(e.target.value)}
        className="border p-2 rounded w-full"
      />
      <input
        type="text"
        placeholder="Contact Title (optional)"
        value={contactTitle}
        onChange={(e) => setContactTitle(e.target.value)}
        className="border p-2 rounded w-full"
      />

      {/* Campaign Type */}
      <div className="space-y-1">
        <label className="text-sm text-gray-500">Campaign Type</label>
        <select
          value={useCase}
          onChange={(e) => setUseCase(e.target.value as UseCaseCode)}
          className="border p-2 rounded w-full bg-white text-black"
        >
          <optgroup label="Common">
            {COMMON_USECASES.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </optgroup>
          <optgroup label="Advanced / Special">
            {ADVANCED_USECASES.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Sample Messages – separate inputs */}
      <div className="space-y-3">
        <label className="text-sm text-gray-500">
          Tip: Use variables like <code>{`{{first_name}}`}</code> and include opt-out language (e.g., “Reply STOP to opt out”).
        </label>
        <textarea
          placeholder="Sample Message #1"
          value={msg1}
          onChange={(e) => setMsg1(e.target.value)}
          className="border p-2 rounded w-full"
          rows={3}
        />
        <textarea
          placeholder="Sample Message #2"
          value={msg2}
          onChange={(e) => setMsg2(e.target.value)}
          className="border p-2 rounded w-full"
          rows={3}
        />
        <textarea
          placeholder="Sample Message #3"
          value={msg3}
          onChange={(e) => setMsg3(e.target.value)}
          className="border p-2 rounded w-full"
          rows={3}
        />
      </div>

      {/* Opt-in Details */}
      <textarea
        placeholder="How do end-users consent to receive messages?"
        value={optInDetails}
        onChange={(e) => setOptInDetails(e.target.value)}
        className="border p-2 rounded w-full"
        rows={10}
      />

      {/* Volume */}
      <input
        type="text"
        placeholder="Estimated Monthly Volume"
        value={volume}
        onChange={(e) => setVolume(e.target.value)}
        className="border p-2 rounded w-full"
      />

      {/* Screenshot Upload */}
      <div className="space-y-2">
        <label className="font-semibold block">Opt-in Screenshot (PNG or JPG)</label>

        <label htmlFor="file-upload" className="cursor-pointer underline text-blue-700 hover:text-blue-900">
          Choose File
        </label>
        <input id="file-upload" type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

        <button
          onClick={handleUpload}
          disabled={uploading}
          className="bg-gray-700 hover:bg-gray-800 disabled:opacity-60 text-white px-4 py-1 rounded cursor-pointer"
        >
          {uploading ? "Uploading..." : "Upload Screenshot"}
        </button>

        {optInScreenshotUrl && (
          <p className="text-green-600 text-sm">
            ✅ Uploaded:{" "}
            <a href={optInScreenshotUrl} className="underline cursor-pointer" target="_blank" rel="noopener noreferrer">
              {optInScreenshotUrl}
            </a>
          </p>
        )}
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded w-full cursor-pointer"
      >
        {submitting ? "Submitting..." : "Submit Verification"}
      </button>
    </div>
  );
}
