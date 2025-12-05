// components/A2PVerificationForm.tsx
import { useState } from "react";
import toast from "react-hot-toast";

type UploadedFileResponse = { url: string; message?: string };

// Twilio / TCR-approved use cases (the common ones first)
type UseCaseCode =
  | "LOW_VOLUME"
  | "MIXED"
  | "MARKETING"
  | "CUSTOMER_CARE"
  | "ACCOUNT_NOTIFICATION"
  | "2FA"
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
  { value: "LOW_VOLUME", label: "Low Volume (mixed)" },
  { value: "MIXED", label: "Mixed" },
  { value: "MARKETING", label: "Marketing / Promotions" },
  { value: "CUSTOMER_CARE", label: "Customer Care / Support" },
  { value: "ACCOUNT_NOTIFICATION", label: "Account Notifications" },
  { value: "2FA", label: "2FA / OTP" },
];

const ADVANCED_SPECIAL: { value: UseCaseCode; label: string }[] = [
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

const US_STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

type FieldErrors = {
  businessName?: string;
  ein?: string;
  address?: string;
  addressCity?: string;
  addressState?: string;
  addressPostalCode?: string;
  addressCountry?: string;
  website?: string;
  email?: string;
  phone?: string;
  contactFirstName?: string;
  contactLastName?: string;
  msg1?: string;
  msg2?: string;
  msg3?: string;
  optInDetails?: string;
  volume?: string;
};

export default function A2PVerificationForm() {
  // ---------- Business ----------
  const [businessName, setBusinessName] = useState("");
  const [ein, setEin] = useState("");

  // Address split into individual fields to match /api/a2p/start
  const [address, setAddress] = useState(""); // street line 1
  const [addressLine2, setAddressLine2] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressPostalCode, setAddressPostalCode] = useState("");
  const [addressCountry, setAddressCountry] = useState("US");

  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // ---------- Explicit link fields (optional but recommended) ----------
  const [landingOptInUrl, setLandingOptInUrl] = useState(""); // page that shows opt-in language + form
  const [landingTosUrl, setLandingTosUrl] = useState(""); // Terms of Service link
  const [landingPrivacyUrl, setLandingPrivacyUrl] = useState(""); // Privacy Policy link

  // ---------- Contact ----------
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactTitle, setContactTitle] = useState("");

  // ---------- Campaign type ----------
  const [usecase, setUsecase] = useState<UseCaseCode>("LOW_VOLUME"); // default to Low Volume (mixed)

  // ---------- Sample Messages (separate boxes) ----------
  const [msg1, setMsg1] = useState(
    `Hi {{first_name}}, it’s {{agent_name}} from our insurance team. You requested info on your life insurance options – when’s a good time for a quick call? Reply STOP to opt out.`,
  );
  const [msg2, setMsg2] = useState(
    `Hi {{first_name}}, you’re pre-approved for benefits this week through the program you opted into. Want to review options now or later today? Reply STOP to unsubscribe.`,
  );
  const [msg3, setMsg3] = useState(
    `Hi {{first_name}}, just following up from your Facebook request for a life insurance quote. This is {{agent_name}} – can I call you real quick? Reply STOP to opt out.`,
  );

  // ---------- Opt-in Details (no template tokens, includes exclusivity) ----------
  const [optInDetails, setOptInDetails] = useState(
    `This campaign sends follow-up messages to users who request life insurance information through TCPA-compliant Facebook lead forms or vendor landing pages. Messages include appointment scheduling, policy information, and benefits reminders for users who have explicitly opted in.

End users opt in by submitting their contact information through a TCPA-compliant lead form hosted on a vendor or agency landing page. The form collects full name, email, and phone number, and includes an electronic signature agreement directly above the “Confirm” button.

Before submission, users see a disclosure similar to:

“By entering your name and information above and clicking this button, you are consenting to receive calls or emails regarding your life insurance options (at any phone number or email address you provide) from a licensed insurance agent or one of our business partners. You agree such calls may use an automatic telephone dialing system or a prerecorded voice to deliver messages even if you are on a government do-not-call registry. This agreement is not a condition of enrollment.”

The form uses click-wrap consent and displays Privacy Policy and Terms & Conditions links on the same page as the form submission. This campaign is exclusive to me. Leads are never resold, reused, or shared with other agents or organizations. Vendors maintain timestamped proof of consent, IP address, and full submission metadata to ensure compliance.`,
  );

  // ---------- Volume + screenshot (screenshot OPTIONAL) ----------
  const [volume, setVolume] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [optInScreenshotUrl, setOptInScreenshotUrl] = useState<string | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ---------- Errors ----------
  const [errors, setErrors] = useState<FieldErrors>({});

  // ---------- Helpers ----------
  const allMessages = [msg1, msg2, msg3].filter(Boolean).join("\n\n");
  const ensureHasStopLanguage = (text: string) =>
    /reply\s+stop/i.test(text) || /text\s+stop/i.test(text);

  const isUsState = (value: string) =>
    US_STATE_CODES.includes(value.trim().toUpperCase());

  const isUsCountry = (value: string) => {
    const v = value.trim().toUpperCase();
    return (
      v === "US" ||
      v === "USA" ||
      v === "UNITED STATES" ||
      v === "UNITED STATES OF AMERICA"
    );
  };

  // EIN formatting: force 9 digits and show as 00-0000000
  const handleEinChange = (value: string) => {
    const digits = value.replace(/[^\d]/g, "").slice(0, 9);
    if (!digits) {
      setEin("");
      setErrors((prev) => ({ ...prev, ein: undefined }));
      return;
    }
    if (digits.length <= 2) {
      setEin(digits);
      return;
    }
    setEin(`${digits.slice(0, 2)}-${digits.slice(2)}`);
    setErrors((prev) => ({ ...prev, ein: undefined }));
  };

  // Strict URL check (must be https and non-localhost-ish)
  const isValidUrl = (value: string) => {
    const v = value.trim();
    if (!/^https:\/\//i.test(v)) return false;
    try {
      const u = new URL(v);
      if (!u.hostname || !u.hostname.includes(".")) return false;
      if (/localhost|127\.0\.0\.1/i.test(u.hostname)) return false;
      return true;
    } catch {
      return false;
    }
  };

  // Email check (simple)
  const isValidEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  // 🔒 Phone: must be EXACTLY 10 digits, no symbols/spaces/parentheses
  const isValidPhone = (value: string) => /^\d{10}$/.test(value.trim());

  const isValidZip = (value: string) =>
    /^[0-9]{5}(-[0-9]{4})?$/.test(value.trim());

  // Required (for quick global check)
  const requiredOk = () =>
    businessName &&
    ein &&
    address &&
    addressCity &&
    addressState &&
    addressPostalCode &&
    addressCountry &&
    website &&
    email &&
    phone &&
    contactFirstName &&
    contactLastName &&
    msg1 &&
    msg2 &&
    msg3 &&
    optInDetails &&
    volume;

  // ---------- Upload (optional) ----------
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error("Please choose a screenshot first.");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/uploadOptIn", {
        method: "POST",
        body: formData,
      });
      const data: UploadedFileResponse = await res.json();

      if (!res.ok) {
        toast.error(data.message || "Upload failed");
        return;
      }

      setOptInScreenshotUrl(data.url);
      toast.success("Screenshot uploaded");
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // ---------- Validate all fields & build errors ----------
  const runValidation = (): boolean => {
    const newErrors: FieldErrors = {};

    // Business name
    if (!businessName.trim()) {
      newErrors.businessName = "Business name is required.";
    } else if (businessName.trim().length < 3) {
      newErrors.businessName =
        "Business name must be at least 3 characters.";
    }

    // EIN
    const einDigits = ein.replace(/[^\d]/g, "");
    if (!einDigits) {
      newErrors.ein = "EIN is required.";
    } else if (einDigits.length !== 9) {
      newErrors.ein =
        'EIN must be 9 digits, e.g. "12-3456789" (no letters or extra symbols).';
    }

    // Address
    if (!address.trim()) {
      newErrors.address = "Street address is required.";
    }
    if (!addressCity.trim()) {
      newErrors.addressCity = "City is required.";
    }
    if (!addressState.trim()) {
      newErrors.addressState = "State is required.";
    } else if (!isUsState(addressState)) {
      newErrors.addressState =
        "Enter a valid 2-letter US state code (e.g., CA, TX).";
    }

    if (!addressPostalCode.trim()) {
      newErrors.addressPostalCode = "ZIP / postal code is required.";
    } else if (!isValidZip(addressPostalCode)) {
      newErrors.addressPostalCode =
        "Enter a valid US ZIP code (12345 or 12345-6789).";
    }

    if (!addressCountry.trim()) {
      newErrors.addressCountry = "Country is required.";
    } else if (!isUsCountry(addressCountry)) {
      newErrors.addressCountry =
        "A2P 10DLC only supports US-based brands. Enter 'US' for the country.";
    }

    // Website
    if (!website.trim()) {
      newErrors.website = "Website URL is required.";
    } else if (!isValidUrl(website)) {
      newErrors.website =
        'Website must be a real, public HTTPS URL (starting with "https://").';
    }

    // Email
    if (!email.trim()) {
      newErrors.email = "Business email is required.";
    } else if (!isValidEmail(email)) {
      newErrors.email = "Enter a valid email address (example@domain.com).";
    }

    // Phone
    if (!phone.trim()) {
      newErrors.phone = "Business / authorized rep phone is required.";
    } else if (!isValidPhone(phone)) {
      newErrors.phone =
        "Phone number must be exactly 10 digits with no spaces, dashes, or parentheses. Example: 5551234567.";
    }

    // Contact names
    if (!contactFirstName.trim()) {
      newErrors.contactFirstName = "Contact first name is required.";
    }
    if (!contactLastName.trim()) {
      newErrors.contactLastName = "Contact last name is required.";
    }

    // Sample messages
    const messages = [msg1, msg2, msg3];
    const msgFields: Array<keyof FieldErrors> = ["msg1", "msg2", "msg3"];

    messages.forEach((m, idx) => {
      const key = msgFields[idx];
      const trimmed = m.trim();
      if (!trimmed) {
        newErrors[key] = `Sample message #${idx + 1} is required.`;
        return;
      }
      if (trimmed.length < 20 || trimmed.length > 320) {
        newErrors[key] =
          "Sample messages must be between 20 and 320 characters.";
      }
      if (!ensureHasStopLanguage(trimmed)) {
        newErrors[key] =
          'Sample messages must include opt-out language like "Reply STOP to opt out".';
      }
    });

    // Opt-in details
    const od = optInDetails.trim();
    if (!od) {
      newErrors.optInDetails = "Opt-in details are required.";
    } else {
      if (od.length < 300) {
        newErrors.optInDetails =
          "Opt-in description must be detailed (at least a few full sentences describing the form, disclosure, and consent).";
      } else if (
        !/consent/i.test(od) ||
        !/(by clicking|by entering)/i.test(od)
      ) {
        newErrors.optInDetails =
          'Opt-in description must clearly state that the user gives consent by clicking/entering their information (e.g., "By entering your information and clicking this button, you consent to receive calls/texts...").';
      }
    }

    // Volume
    const volDigits = volume.replace(/[^\d]/g, "");
    if (!volDigits) {
      newErrors.volume =
        "Estimated monthly volume is required as a number (e.g., 500).";
    } else {
      const num = parseInt(volDigits, 10);
      if (Number.isNaN(num) || num <= 0) {
        newErrors.volume = "Monthly volume must be a positive number.";
      } else if (num > 250000) {
        newErrors.volume =
          "Monthly volume must be realistic for review (<= 250,000 messages).";
      }
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      toast.error("Please fix the highlighted errors and try again.");
      return false;
    }
    return true;
  };

  // ---------- Submit ----------
  const handleSubmit = async () => {
    // run full field-level validation first
    if (!runValidation()) return;

    if (!requiredOk()) {
      // this is just a backup; in practice runValidation covers this
      toast.error("Please complete all required fields.");
      return;
    }

    // Soft warnings for optional-but-recommended artifacts
    if (!landingOptInUrl) {
      toast(
        (t) => (
          <span>
            <b>Heads up:</b> A public opt-in page URL greatly improves approval
            speed. You can submit now and add it later.
            <button
              onClick={() => toast.dismiss(t.id)}
              className="ml-2 underline"
            >
              OK
            </button>
          </span>
        ),
        { duration: 6000 },
      );
    }

    setSubmitting(true);
    try {
      const payload = {
        businessName,
        ein, // backend normalizes to digits and enforces 9-digit EIN

        // Address pieces expected by /api/a2p/start
        address, // street line 1
        addressLine2: addressLine2 || undefined,
        addressCity,
        addressState: addressState.toUpperCase().trim(),
        addressPostalCode,
        addressCountry: addressCountry.toUpperCase().trim(),

        website: website.trim(),
        email: email.trim(),
        phone: phone.trim(),
        contactFirstName: contactFirstName.trim(),
        contactLastName: contactLastName.trim(),
        contactTitle: contactTitle.trim(),

        // campaign type for both existing endpoints
        usecaseCode: usecase, // /api/a2p/start expects this
        useCase: usecase, // /api/a2p/submit-campaign expects this (if used)

        // messages
        sampleMessages: allMessages,
        sampleMessage1: msg1,
        sampleMessage2: msg2,
        sampleMessage3: msg3,

        optInDetails,
        volume,

        // optional artifacts (included if provided)
        optInScreenshotUrl: optInScreenshotUrl || undefined,
        landingOptInUrl: landingOptInUrl || undefined,
        landingTosUrl: landingTosUrl || undefined,
        landingPrivacyUrl: landingPrivacyUrl || undefined,
      };

      const res = await fetch("/api/registerA2P", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // backend may send generic message; just show toast
        toast.error(data.message || "Submission failed");
        return;
      }

      toast.success(
        "Verification submitted! We’ll notify you when it’s approved or if changes are needed.",
      );
    } catch (err) {
      console.error("Submission error:", err);
      toast.error("Error submitting verification");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- UI ----------
  return (
    <div className="border border-black dark:border-white p-4 rounded space-y-4">
      <h2 className="text-xl font-bold">A2P Brand Verification</h2>

      {/* Business */}
      <div>
        <input
          type="text"
          placeholder="Business Name"
          value={businessName}
          onChange={(e) => {
            setBusinessName(e.target.value);
            setErrors((prev) => ({ ...prev, businessName: undefined }));
          }}
          className="border p-2 rounded w-full"
        />
        {errors.businessName && (
          <p className="text-xs text-red-500 mt-1">{errors.businessName}</p>
        )}
      </div>

      <div>
        <input
          type="text"
          placeholder="EIN (00-0000000)"
          value={ein}
          onChange={(e) => handleEinChange(e.target.value)}
          className="border p-2 rounded w-full"
        />
        {errors.ein && (
          <p className="text-xs text-red-500 mt-1">{errors.ein}</p>
        )}
      </div>

      {/* Address fields */}
      <div className="space-y-2">
        <div>
          <input
            type="text"
            placeholder="Street Address"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setErrors((prev) => ({ ...prev, address: undefined }));
            }}
            className="border p-2 rounded w-full"
          />
          {errors.address && (
            <p className="text-xs text-red-500 mt-1">{errors.address}</p>
          )}
        </div>
        <input
          type="text"
          placeholder="Address Line 2 (optional)"
          value={addressLine2}
          onChange={(e) => setAddressLine2(e.target.value)}
          className="border p-2 rounded w-full"
        />
        <div className="grid md:grid-cols-3 gap-2">
          <div>
            <input
              type="text"
              placeholder="City"
              value={addressCity}
              onChange={(e) => {
                setAddressCity(e.target.value);
                setErrors((prev) => ({ ...prev, addressCity: undefined }));
              }}
              className="border p-2 rounded w-full"
            />
            {errors.addressCity && (
              <p className="text-xs text-red-500 mt-1">
                {errors.addressCity}
              </p>
            )}
          </div>
          <div>
            <input
              type="text"
              placeholder="State (2-letter, e.g., CA)"
              value={addressState}
              onChange={(e) => {
                setAddressState(e.target.value.toUpperCase());
                setErrors((prev) => ({ ...prev, addressState: undefined }));
              }}
              className="border p-2 rounded w-full"
            />
            {errors.addressState && (
              <p className="text-xs text-red-500 mt-1">
                {errors.addressState}
              </p>
            )}
          </div>
          <div>
            <input
              type="text"
              placeholder="ZIP / Postal Code"
              value={addressPostalCode}
              onChange={(e) => {
                setAddressPostalCode(e.target.value);
                setErrors((prev) => ({
                  ...prev,
                  addressPostalCode: undefined,
                }));
              }}
              className="border p-2 rounded w-full"
            />
            {errors.addressPostalCode && (
              <p className="text-xs text-red-500 mt-1">
                {errors.addressPostalCode}
              </p>
            )}
          </div>
        </div>
        <div>
          <input
            type="text"
            placeholder="Country (US only)"
            value={addressCountry}
            onChange={(e) => {
              setAddressCountry(e.target.value);
              setErrors((prev) => ({ ...prev, addressCountry: undefined }));
            }}
            className="border p-2 rounded w-full"
          />
          {errors.addressCountry && (
            <p className="text-xs text-red-500 mt-1">
              {errors.addressCountry}
            </p>
          )}
        </div>
      </div>

      <div>
        <input
          type="url"
          placeholder="Website URL (must start with https://)"
          value={website}
          onChange={(e) => {
            setWebsite(e.target.value);
            setErrors((prev) => ({ ...prev, website: undefined }));
          }}
          className="border p-2 rounded w-full"
        />
        {errors.website && (
          <p className="text-xs text-red-500 mt-1">{errors.website}</p>
        )}
      </div>

      <div>
        <input
          type="email"
          placeholder="Business Email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          className="border p-2 rounded w-full"
        />
        {errors.email && (
          <p className="text-xs text-red-500 mt-1">{errors.email}</p>
        )}
      </div>

      <div>
        <input
          type="text"
          placeholder="Business / Authorized Rep Phone (10 digits only)"
          value={phone}
          onChange={(e) => {
            const v = e.target.value;
            setPhone(v);
            // Live validation for non-digit characters
            if (!/^\d*$/.test(v)) {
              setErrors((prev) => ({
                ...prev,
                phone:
                  "Phone number can only contain digits 0–9 (no spaces, dashes, or parentheses).",
              }));
            } else {
              setErrors((prev) => ({ ...prev, phone: undefined }));
            }
          }}
          className="border p-2 rounded w-full"
        />
        {errors.phone && (
          <p className="text-xs text-red-500 mt-1">{errors.phone}</p>
        )}
        {!errors.phone && (
          <p className="text-xs text-gray-500 mt-1">
            Enter exactly 10 digits (e.g. 5551234567). No spaces, dashes, or
            parentheses. We’ll convert it to +1 format for Twilio automatically.
          </p>
        )}
      </div>

      {/* Campaign Type */}
      <div className="space-y-1">
        <label className="text-sm text-gray-500">Campaign Type</label>
        <select
          className="border p-2 rounded w-full bg-white text-black"
          value={usecase}
          onChange={(e) => setUsecase(e.target.value as UseCaseCode)}
        >
          <optgroup label="Common">
            {COMMON_USECASES.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Advanced / Special">
            {ADVANCED_SPECIAL.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </optgroup>
        </select>
        <p className="text-xs text-gray-500">
          “Low Volume (mixed)” is suitable for most small businesses sending a
          mix of conversational, marketing, and informational messages at modest
          volumes.
        </p>
      </div>

      {/* Links (optional but recommended) */}
      <div className="grid md:grid-cols-2 gap-3">
        <input
          type="url"
          placeholder="Landing Page URL (shows opt-in language)"
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
        <p className="md:col-span-2 text-xs text-gray-500">
          These links are optional but strongly recommended. A public page
          showing how users opt in significantly reduces review delays and
          declines.
        </p>
      </div>

      {/* Contact */}
      <div>
        <input
          type="text"
          placeholder="Contact First Name"
          value={contactFirstName}
          onChange={(e) => {
            setContactFirstName(e.target.value);
            setErrors((prev) => ({ ...prev, contactFirstName: undefined }));
          }}
          className="border p-2 rounded w-full"
        />
        {errors.contactFirstName && (
          <p className="text-xs text-red-500 mt-1">
            {errors.contactFirstName}
          </p>
        )}
      </div>
      <div>
        <input
          type="text"
          placeholder="Contact Last Name"
          value={contactLastName}
          onChange={(e) => {
            setContactLastName(e.target.value);
            setErrors((prev) => ({ ...prev, contactLastName: undefined }));
          }}
          className="border p-2 rounded w-full"
        />
        {errors.contactLastName && (
          <p className="text-xs text-red-500 mt-1">
            {errors.contactLastName}
          </p>
        )}
      </div>
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
          Tip: Use variables like <code>{`{{first_name}}`}</code> and include
          opt-out language (e.g., “Reply STOP to opt out”).
        </label>
        <div>
          <textarea
            placeholder="Sample Message #1"
            value={msg1}
            onChange={(e) => {
              setMsg1(e.target.value);
              setErrors((prev) => ({ ...prev, msg1: undefined }));
            }}
            className="border p-2 rounded w-full"
            rows={3}
          />
          {errors.msg1 && (
            <p className="text-xs text-red-500 mt-1">{errors.msg1}</p>
          )}
        </div>
        <div>
          <textarea
            placeholder="Sample Message #2"
            value={msg2}
            onChange={(e) => {
              setMsg2(e.target.value);
              setErrors((prev) => ({ ...prev, msg2: undefined }));
            }}
            className="border p-2 rounded w-full"
            rows={3}
          />
          {errors.msg2 && (
            <p className="text-xs text-red-500 mt-1">{errors.msg2}</p>
          )}
        </div>
        <div>
          <textarea
            placeholder="Sample Message #3"
            value={msg3}
            onChange={(e) => {
              setMsg3(e.target.value);
              setErrors((prev) => ({ ...prev, msg3: undefined }));
            }}
            className="border p-2 rounded w-full"
            rows={3}
          />
          {errors.msg3 && (
            <p className="text-xs text-red-500 mt-1">{errors.msg3}</p>
          )}
        </div>
      </div>

      {/* Opt-in Details */}
      <div>
        <textarea
          placeholder="How do end-users consent to receive messages?"
          value={optInDetails}
          onChange={(e) => {
            setOptInDetails(e.target.value);
            setErrors((prev) => ({ ...prev, optInDetails: undefined }));
          }}
          className="border p-2 rounded w-full"
          rows={10}
        />
        {errors.optInDetails && (
          <p className="text-xs text-red-500 mt-1">{errors.optInDetails}</p>
        )}
      </div>

      {/* Volume */}
      <div>
        <input
          type="text"
          placeholder="Estimated Monthly Volume (number only, e.g. 500)"
          value={volume}
          onChange={(e) => {
            setVolume(e.target.value);
            setErrors((prev) => ({ ...prev, volume: undefined }));
          }}
          className="border p-2 rounded w-full"
        />
        {errors.volume && (
          <p className="text-xs text-red-500 mt-1">{errors.volume}</p>
        )}
      </div>

      {/* Screenshot Upload (optional) */}
      <div className="space-y-2">
        <label className="font-semibold block">
          Screenshot of opt-in language (optional)
        </label>
        <p className="text-xs text-gray-500">
          A screenshot of your opt-in form/page helps reviewers verify consent
          flow quickly.
        </p>

        <label
          htmlFor="file-upload"
          className="cursor-pointer underline text-blue-700 hover:text-blue-900"
        >
          Choose File
        </label>
        <input
          id="file-upload"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />

        <button
          onClick={handleUpload}
          disabled={uploading || !file}
          className="bg-gray-700 hover:bg-gray-800 disabled:opacity-60 text-white px-4 py-1 rounded cursor-pointer"
        >
          {uploading ? "Uploading..." : "Upload Screenshot"}
        </button>

        {optInScreenshotUrl && (
          <p className="text-green-600 text-sm">
            Uploaded:{" "}
            <a
              href={optInScreenshotUrl}
              className="underline cursor-pointer"
              target="_blank"
              rel="noopener noreferrer"
            >
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
