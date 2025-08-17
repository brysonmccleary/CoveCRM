// components/ProfilePanel.tsx
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";
import toast from "react-hot-toast";

type ProfilePayload = {
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  agentPhone: string;
  workingHours?: any; // keep whatever server returns; we pass it back unchanged
};

function normalizeUSPhone(raw: string) {
  const d = (raw || "").replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return raw.trim(); // leave as-is for non-US numbers
}

export default function ProfilePanel() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const [profile, setProfile] = useState<ProfilePayload>({
    firstName: "",
    lastName: "",
    email: "",
    country: "United States",
    agentPhone: "",
    workingHours: undefined,
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // 🔄 Prefill from API (server truth), not from session
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setInitializing(true);
        const { data } = await axios.get("/api/settings/profile");
        if (!active) return;
        setProfile({
          firstName: data.firstName || "",
          lastName: data.lastName || "",
          email: data.email || "",
          country: data.country || "United States",
          agentPhone: data.agentPhone || "",
          workingHours: data.workingHours, // keep round-tripped
        });
      } catch (e: any) {
        toast.error(e?.response?.data?.message || "Failed to load profile.");
      } finally {
        if (active) setInitializing(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleProfileSave = async () => {
    try {
      setLoading(true);
      const payload: ProfilePayload = {
        ...profile,
        agentPhone: normalizeUSPhone(profile.agentPhone),
      };
      await axios.post("/api/settings/update-profile", payload);
      toast.success("Profile updated!");
      // Optional: refresh from server to reflect any normalization
      const { data } = await axios.get("/api/settings/profile");
      setProfile({
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        email: data.email || "",
        country: data.country || "United States",
        agentPhone: data.agentPhone || "",
        workingHours: data.workingHours,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to update profile.");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSave = async () => {
    if (newPassword !== confirmPassword) return toast.error("Passwords do not match.");
    if (newPassword.length < 6) return toast.error("Password too short.");

    try {
      setLoading(true);
      await axios.post("/api/user/update-password", {
        email: session?.user?.email,
        password: currentPassword,
        newPassword,
      });
      toast.success("Password updated!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to update password.");
    } finally {
      setLoading(false);
    }
  };

  const affiliateCode = (session as any)?.user?.affiliateCode;

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 bg-[#1e293b] text-white space-y-12 rounded-lg shadow">
      {/* Profile Info */}
      <section>
        <h2 className="text-xl font-semibold mb-6">Your Profile</h2>

        {initializing ? (
          <div className="text-sm text-gray-300">Loading profile…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1">First Name</label>
                <input
                  className="w-full bg-[#0f172a] border border-gray-600 px-3 py-2 rounded-md"
                  value={profile.firstName}
                  onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Last Name</label>
                <input
                  className="w-full bg-[#0f172a] border border-gray-600 px-3 py-2 rounded-md"
                  value={profile.lastName}
                  onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                />
              </div>
            </div>

            {/* NEW: Agent Phone */}
            <div className="mt-4">
              <label className="block text-sm mb-1">Agent Phone (where calls should ring)</label>
              <input
                className="w-full bg-[#0f172a] border border-gray-600 px-3 py-2 rounded-md"
                value={profile.agentPhone}
                onChange={(e) => setProfile({ ...profile, agentPhone: e.target.value })}
                onBlur={() =>
                  setProfile((p) => ({ ...p, agentPhone: normalizeUSPhone(p.agentPhone) }))
                }
                placeholder="+15551234567"
              />
              <p className="text-xs text-gray-400 mt-1">
                We’ll call this number first and bridge the lead automatically.
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-sm mb-1">Country</label>
              <select
                className="w-full bg-[#0f172a] border border-gray-600 px-3 py-2 rounded-md"
                value={profile.country}
                onChange={(e) => setProfile({ ...profile, country: e.target.value })}
              >
                <option>United States</option>
                <option>Canada</option>
                <option>United Kingdom</option>
                <option>Australia</option>
              </select>
            </div>

            <button
              onClick={handleProfileSave}
              disabled={loading}
              className="mt-4 bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-white"
            >
              Save Changes
            </button>
          </>
        )}
      </section>

      {/* Email */}
      <section>
        <h2 className="text-xl font-semibold mb-6">Email Address</h2>
        <label className="block text-sm mb-1">Email</label>
        <input
          className="w-full bg-[#0f172a] border border-gray-600 px-3 py-2 rounded-md"
          value={profile.email}
          onChange={(e) => setProfile({ ...profile, email: e.target.value })}
        />
        <button
          onClick={handleProfileSave}
          disabled={loading}
          className="mt-4 bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-white"
        >
          Save Email
        </button>
      </section>

      {/* Password */}
      <section>
        <h2 className="text-xl font-semibold mb-6">Change Password</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm mb-1">Current Password</label>
            <input
              type="password"
              className="w-full bg-[#0f172a] border border-gray-600 px-3 py-2 rounded-md"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">New Password</label>
            <input
              type="password"
              className="w-full bg-[#0f172a] border border-gray-600 px-3 py-2 rounded-md"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Confirm Password</label>
            <input
              type="password"
              className="w-full bg-[#0f172a] border border-gray-600 px-3 py-2 rounded-md"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
        <button
          onClick={handlePasswordSave}
          disabled={loading}
          className="mt-4 bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-white"
        >
          Save Password
        </button>
      </section>

      {/* Affiliate Code */}
      {((session as any)?.user?.affiliateCode) && (
        <section>
          <h2 className="text-xl font-semibold mb-6">Affiliate Program</h2>
          <p className="text-sm mb-2">Your referral code:</p>
          <div className="bg-[#0f172a] border border-gray-600 px-4 py-2 rounded text-sm font-mono">
            {(session as any).user.affiliateCode}
          </div>
        </section>
      )}
    </div>
  );
}
