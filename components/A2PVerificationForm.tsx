// components/A2PVerificationForm.tsx
import { useState } from "react";
import toast from "react-hot-toast";

type UploadedFileResponse = { url: string; message?: string };

export default function A2PVerificationForm() {
  // ---------- Business ----------
  const [businessName, setBusinessName] = useState("");
  const [ein, setEin] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // ---------- Explicit link fields (front-and-center) ----------
  const [landingOptInUrl, setLandingOptInUrl] = useState("");     // page that shows opt-in language + form
  const [landingTosUrl, setLandingTosUrl] = useState("");         // Terms of Service link
  const [landingPrivacyUrl, setLandingPrivacyUrl] = useState(""); // Privacy Policy link

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

  // ---------- Opt-in Details (no template tokens, includes exclusivity) ----------
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

  // ---------- Helpers ----------
  const allMessages = [msg1, msg2, msg3].filter(Boolean).join("\n\n");

  const ensureHasStopLanguage = (text: string) =>
    /reply\s+stop/i.test(text) || /text\s+stop/i.test(text);

  const requiredOk = () =>
    businessName &&
    ein &&
    address &&
    website &&
    email &&
    phone &&
    landingOptInUrl &&
    landingTosUrl &&
    landingPrivacyUrl &&
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

    // Light guard to keep Twilio happy: each sample message should show STOP language
    if (![msg1, msg2, msg3].every(ensureHasStopLanguage)) {
      toast.error("❌ Each sample message must include opt-out language (e.g., “Reply STOP to opt out”).");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/registerA2P", {
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

          // Send as a single blob too, for your existing API
          sampleMessages: allMessages,

          // Or send individually if your API prefers
          sampleMessage1: msg1,
          sampleMessage2: msg2,
          sampleMessage3: msg3,

          optInDetails,
          volume,
          optInScreenshotUrl,

          // explicit link fields
          landingOptInUrl,
          landingTosUrl,
          landingPrivacyUrl,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`❌ ${data.message || "Submission failed"}`);
        return;
      }

      toast.success("✅ Verification submitted! Awaiting Twilio approval.");
    } catch (err) {
      console.error("Submission error:", err);
      toast.error("❌ Error submitting verification");
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
          placeholder="Terms of Service URL"
          value={landingTosUrl}
          onChange={(e) => setLandingTosUrl(e.target.value)}
          className="border p-2 rounded w-full"
        />
        <input
          type="url"
          placeholder="Privacy Policy URL"
          value={landingPrivacyUrl}
          onChange={(e) => setLandingPrivacyUrl(e.target.value)}
          className="border p-2 rounded w-full md:col-span-2"
        />
      </div>

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
