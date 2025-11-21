// /pages/settings.tsx
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import DashboardLayout from "@/components/DashboardLayout";

// Panels
import ProfilePanel from "@/components/settings/ProfilePanel";
import ReferralPanel from "@/components/settings/ReferralPanel";
import A2PVerificationPanel from "@/components/settings/A2PVerificationPanel";
import AffiliatePanel from "@/components/Admin/AffiliatePanel";
import AffiliatesDashboard from "@/components/Admin/AffiliatesDashboard";
import AffiliateCodeManager from "@/components/Admin/AffiliateCodeManager";

const sections = [
  {
    id: "account",
    label: "Account",
    children: [
      { id: "profile", label: "Profile" },
      { id: "a2p", label: "A2P Registration" },
      // AI Assistant tab removed for now
    ],
  },
  {
    id: "affiliate",
    label: "Affiliate",
    children: [
      { id: "referral", label: "Referral Dashboard" },
      { id: "settings", label: "Affiliate Settings" },
    ],
  },
  {
    id: "admin",
    label: "Admin Tools",
    children: [
      { id: "dashboard", label: "Affiliate Dashboard" },
      { id: "codes", label: "Affiliate Code Manager" },
    ],
  },
];

export default function SettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "admin";
  const [activeTab, setActiveTab] = useState("profile");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);

    // legacy flags
    const connected = query.get("connected");
    const error = query.get("error");

    // new calendar flags from our Google callback
    const calendar = query.get("calendar"); // "connected" | "needs_reconnect"

    if (calendar === "connected") {
      setMessage(
        "✅ Google Calendar connected. Bookings will be created automatically.",
      );
    } else if (calendar === "needs_reconnect") {
      setMessage(
        "⚠️ Google connected without a refresh token. Please reconnect to enable automation.",
      );
    } else if (connected === "google") {
      setMessage("✅ Google Account connected successfully!");
    } else if (error === "google") {
      setMessage("❌ Failed to connect Google Account.");
    } else if (connected === "stripe") {
      setMessage("✅ Stripe Connect onboarding completed!");
    }

    const timer = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(timer);
  }, []);

  const renderTabContent = () => {
    switch (activeTab) {
      case "profile":
        return <ProfilePanel />;
      case "a2p":
        return <A2PVerificationPanel />;
      case "referral":
        return <ReferralPanel />;
      case "settings":
        return session?.user?.email ? (
          <AffiliatePanel userEmail={session.user.email} />
        ) : null;
      case "dashboard":
        return isAdmin ? <AffiliatesDashboard /> : <p>Not authorized.</p>;
      case "codes":
        return isAdmin ? <AffiliateCodeManager /> : <p>Not authorized.</p>;
      default:
        return <p>Select a setting to begin.</p>;
    }
  };

  return (
    <DashboardLayout>
      <div className="flex min-h-screen bg-[#1e293b] text-white">
        {/* Sidebar */}
        <aside className="w-64 border-r border-gray-800 p-4 bg-[#0f172a] overflow-y-auto">
          <h2 className="text-lg font-bold mb-4 text-white">Settings</h2>

          {message && (
            <div className="mb-4 text-sm px-3 py-2 rounded bg-blue-700/20 text-blue-300">
              {message}
            </div>
          )}

          <nav className="space-y-6">
            {sections.map((section) => (
              <div key={section.id}>
                <h3 className="text-xs text-gray-400 uppercase font-semibold mb-2">
                  {section.label}
                </h3>
                <div className="space-y-1">
                  {section.children.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => setActiveTab(child.id)}
                      className={`block w-full text-left px-3 py-2 rounded text-sm transition font-medium ${
                        activeTab === child.id
                          ? "bg-blue-600 text-white"
                          : "bg-[#1e293b] text-gray-300 hover:bg-gray-700 hover:text-white"
                      }`}
                    >
                      {child.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8 overflow-y-auto bg-[#1e293b]">
          {renderTabContent()}
        </main>
      </div>
    </DashboardLayout>
  );
}
