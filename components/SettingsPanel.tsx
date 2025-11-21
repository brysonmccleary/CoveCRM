// /components/settingspanel.tsx
import { useEffect, useState } from "react";
import A2PVerificationForm from "@/components/A2PVerificationForm";
import AffiliateProgramPanel from "@/components/settings/AffiliateProgramPanel";
import BillingPanel from "@/components/settings/BillingPanel";
import toast from "react-hot-toast";
import InvoicesPanel from "@/components/settings/InvoicesPanel";

type DayKey = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";
type WorkingHours = {
  [key in DayKey]: { start: string; end: string };
};

function normalizeUSPhone(raw: string) {
  const d = (raw || "").replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return raw.trim(); // allow non-US (+44 etc.)
}

export default function SettingsPanel() {
  const [activeTab, setActiveTab] = useState("profile");

  // Profile state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [country, setCountry] = useState("United States");
  const [email, setEmail] = useState("");
  const [agentPhone, setAgentPhone] = useState("");

  // Password update state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Booking settings
  const [timezone, setTimezone] = useState("");
  const [slotLength, setSlotLength] = useState(15);
  const [bufferTime, setBufferTime] = useState(5);
  const [maxPerDay, setMaxPerDay] = useState(10);
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [workingHours, setWorkingHours] = useState<WorkingHours>({
    Monday: { start: "08:00", end: "21:00" },
    Tuesday: { start: "08:00", end: "21:00" },
    Wednesday: { start: "08:00", end: "21:00" },
    Thursday: { start: "08:00", end: "21:00" },
    Friday: { start: "08:00", end: "21:00" },
  });

  // Notification settings
  const [emailReminders, setEmailReminders] = useState(true);
  const [dripAlerts, setDripAlerts] = useState(true);
  const [bookingConfirmations, setBookingConfirmations] = useState(true);

  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);

    const loadProfile = async () => {
      try {
        const res = await fetch("/api/settings/profile");
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to load profile");

        setFirstName(data.firstName || "");
        setLastName(data.lastName || "");
        setEmail(data.email || "");
        setCountry(data.country || "United States");
        setAgentPhone(data.agentPhone || "");
        if (data.workingHours) setWorkingHours(data.workingHours);
      } catch (err: any) {
        toast.error(err.message || "Error loading profile");
      }
    };

    const loadNotifications = async () => {
      try {
        const res = await fetch("/api/settings/notifications");
        const data = await res.json();
        if (!res.ok) {
          console.warn("Notification settings failed to load.");
          return;
        }
        setEmailReminders(data.emailReminders);
        setDripAlerts(data.dripAlerts);
        setBookingConfirmations(data.bookingConfirmations);
      } catch {
        console.warn("Silent catch - Notification settings not found.");
      }
    };

    loadProfile();
    loadNotifications();
  }, []);

  const handleSaveProfile = async () => {
    try {
      const res = await fetch("/api/settings/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          country,
          agentPhone: normalizeUSPhone(agentPhone),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update profile");

      // Refresh from server to reflect any normalization
      const r = await fetch("/api/settings/profile");
      const p = await r.json();
      setAgentPhone(p.agentPhone || "");

      toast.success("Profile updated successfully!");
    } catch (err: any) {
      toast.error(err.message || "Something went wrong.");
    }
  };

  const handleEmailChange = async () => {
    try {
      const res = await fetch("/api/settings/update-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail: email }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update email");

      toast.success("Email updated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to update email.");
    }
  };

  const handlePasswordUpdate = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    try {
      const res = await fetch("/api/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update password");

      toast.success("Password updated successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleSaveBooking = async () => {
    try {
      const res = await fetch("/api/update-booking-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone,
          slotLength,
          bufferTime,
          maxPerDay,
          autoConfirm,
          workingHours,
        }),
      });

      if (!res.ok) throw new Error("Failed to update settings");
      toast.success("Booking settings updated!");
    } catch {
      toast.error("Error saving booking settings.");
    }
  };

  const handleSaveNotifications = async () => {
    try {
      const res = await fetch("/api/settings/update-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailReminders,
          dripAlerts,
          bookingConfirmations,
        }),
      });

      if (!res.ok) throw new Error("Failed to save notifications");
      toast.success("Notification settings saved!");
    } catch (err: any) {
      toast.error(err.message || "Error saving notifications");
    }
  };

  const updateHour = (day: DayKey, field: "start" | "end", value: string) => {
    setWorkingHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "account", label: "Booking Settings" },
    { id: "notifications", label: "Notifications" },
    { id: "a2p", label: "A2P Verification" },
    { id: "billing", label: "Billing & Usage" },
    { id: "invoices", label: "Invoices" },
    { id: "affiliate", label: "Affiliate Program" },
    { id: "legal", label: "Legal" },
  ];

  return (
    <div className="flex min-h-screen text-white bg-[#1e293b]">
      <aside className="w-64 p-6 border-r border-gray-700 bg-[#1e293b]">
        <h2 className="text-xl font-bold mb-6">Settings</h2>
        <div className="space-y-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`block w-full text-left px-3 py-2 rounded cursor-pointer ${
                activeTab === tab.id
                  ? "bg-gray-700 font-semibold"
                  : "hover:bg-gray-800 transition"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto bg-[#1e293b]">
        {activeTab === "profile" && (
          <div className="space-y-8 max-w-xl">
            <h2 className="text-2xl font-bold">Your Profile</h2>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="First Name"
                className="bg-[#334155] p-3 rounded-md w-full"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
              <input
                type="text"
                placeholder="Last Name"
                className="bg-[#334155] p-3 rounded-md w-full"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
              <select
                className="bg-[#334155] p-3 rounded-md w-full"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                <option>United States</option>
                <option>Canada</option>
                <option>UK</option>
              </select>
            </div>

            {/* Agent Phone */}
            <div>
              <label className="block text-sm mb-2">
                Agent Phone (where calls should ring)
              </label>
              <input
                type="tel"
                inputMode="tel"
                placeholder="+15551234567"
                className="bg-[#334155] p-3 rounded-md w-full"
                value={agentPhone}
                onChange={(e) => setAgentPhone(e.target.value)}
                onBlur={() => setAgentPhone((p) => normalizeUSPhone(p))}
              />
              <p className="text-xs text-gray-300 mt-1">
                We’ll call this number first and automatically bridge to your lead.
              </p>
            </div>

            <button
              onClick={handleSaveProfile}
              className="mt-2 px-6 py-2 bg-green-600 hover:bg-green-700 rounded-md font-bold"
            >
              Save Profile
            </button>

            <h3 className="text-xl font-semibold pt-8">Email Address</h3>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-[#334155] p-3 rounded-md w-full mt-2"
            />
            <button
              onClick={handleEmailChange}
              className="mt-2 px-6 py-2 bg-green-600 hover:bg-green-700 rounded-md font-bold"
            >
              Save Email
            </button>

            <h3 className="text-xl font-semibold pt-8">Update Password</h3>
            <input
              type="password"
              placeholder="Current Password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="bg-[#334155] p-3 rounded-md w-full mt-2"
            />
            <input
              type="password"
              placeholder="New Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-[#334155] p-3 rounded-md w-full mt-2"
            />
            <input
              type="password"
              placeholder="Confirm New Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="bg-[#334155] p-3 rounded-md w-full mt-2"
            />
            <button
              onClick={handlePasswordUpdate}
              className="mt-2 px-6 py-2 bg-green-600 hover:bg-green-700 rounded-md font-bold"
            >
              Save Password
            </button>
          </div>
        )}

        {activeTab === "account" && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-2xl font-bold">Booking Settings</h2>
            <label className="block font-medium mb-1">Timezone</label>
            <input
              type="text"
              className="bg-[#334155] p-3 rounded-md w-full"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block mb-1">Slot Length</label>
                <input
                  type="number"
                  value={slotLength}
                  onChange={(e) => setSlotLength(parseInt(e.target.value))}
                  className="bg-[#334155] p-3 rounded-md w-full"
                />
              </div>
              <div>
                <label className="block mb-1">Buffer Time</label>
                <input
                  type="number"
                  value={bufferTime}
                  onChange={(e) => setBufferTime(parseInt(e.target.value))}
                  className="bg-[#334155] p-3 rounded-md w-full"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block mb-1">Max Appointments / Day</label>
                <input
                  type="number"
                  value={maxPerDay}
                  onChange={(e) => setMaxPerDay(parseInt(e.target.value))}
                  className="bg-[#334155] p-3 rounded-md w-full"
                />
              </div>
              <div className="flex items-center space-x-2 mt-6">
                <input
                  type="checkbox"
                  checked={autoConfirm}
                  onChange={(e) => setAutoConfirm(e.target.checked)}
                  className="w-5 h-5"
                />
                <span className="font-medium">Auto-confirm bookings</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="block font-semibold">Working Hours</label>
              {Object.entries(workingHours).map(([day, times]) => (
                <div key={day} className="flex items-center gap-4">
                  <span className="w-24">{day}</span>
                  <input
                    type="time"
                    value={times.start}
                    onChange={(e) =>
                      updateHour(day as DayKey, "start", e.target.value)
                    }
                    className="bg-[#334155] p-2 rounded-md"
                  />
                  <span>-</span>
                  <input
                    type="time"
                    value={times.end}
                    onChange={(e) =>
                      updateHour(day as DayKey, "end", e.target.value)
                    }
                    className="bg-[#334155] p-2 rounded-md"
                  />
                </div>
              ))}
            </div>
            <button
              onClick={handleSaveBooking}
              className="mt-4 px-6 py-3 bg-green-600 hover:bg-green-700 transition rounded-md font-bold"
            >
              Save Settings
            </button>
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="space-y-4 max-w-xl">
            <h2 className="text-2xl font-bold mb-4">Notification Preferences</h2>
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={emailReminders}
                  onChange={(e) => setEmailReminders(e.target.checked)}
                  className="w-5 h-5"
                />
                <span>Email Reminders</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={dripAlerts}
                  onChange={(e) => setDripAlerts(e.target.checked)}
                  className="w-5 h-5"
                />
                <span>Drip Reply Alerts</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={bookingConfirmations}
                  onChange={(e) => setBookingConfirmations(e.target.checked)}
                  className="w-5 h-5"
                />
                <span>Booking Confirmations</span>
              </label>
            </div>
            <button
              onClick={handleSaveNotifications}
              className="mt-4 px-6 py-3 bg-green-600 hover:bg-green-700 transition rounded-md font-bold"
            >
              Save Notification Settings
            </button>
          </div>
        )}

        {activeTab === "a2p" && (
          <div>
            <A2PVerificationForm />
          </div>
        )}

        {activeTab === "billing" && (
          <div>
            <h2 className="text-2xl font-bold mb-4">Billing & Usage</h2>
            <BillingPanel />
          </div>
        )}

        {activeTab === "invoices" && (
          <div>
            <InvoicesPanel />
          </div>
        )}

        {activeTab === "affiliate" && <AffiliateProgramPanel />}

        {activeTab === "legal" && (
          <div className="space-y-6 max-w-xl">
            <h2 className="text-2xl font-bold mb-4">Legal Policies</h2>
            <ul className="space-y-2 text-blue-400 underline">
              <li>
                <a href="/legal/terms" target="_blank" rel="noopener noreferrer">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="/legal/privacy" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a
                  href="/legal/refund-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Refund Policy
                </a>
              </li>
              <li>
                <a
                  href="/legal/acceptable-use"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Acceptable Use Policy
                </a>
              </li>
              <li>
                <a
                  href="/legal/affiliate-terms"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Affiliate Program Terms
                </a>
              </li>
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
