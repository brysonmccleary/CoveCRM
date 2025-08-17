import { useState } from "react";
import SettingsSidebar from "./SettingsSidebar";
import ProfilePanel from "@/components/settings/ProfilePanel"; // ✅ Real UI
import BillingPanel from "./BillingPanel";
import ReferralPanel from "./ReferralPanel";

export default function SettingsLayout() {
  const [selected, setSelected] = useState("Profile");

  const renderPanel = () => {
    switch (selected) {
      case "Profile":
        return <ProfilePanel />; // ✅ Real profile panel (not placeholder)
      case "Booking":
        return (
          <div className="p-6 text-gray-500 text-sm">
            Booking settings coming soon.
          </div>
        );
      case "Plan":
      case "Payment":
      case "Usage":
        return <BillingPanel />;
      case "Memberships":
        return <ReferralPanel />;
      default:
        return <div className="p-6 text-gray-400">Coming Soon</div>;
    }
  };

  return (
    <div className="flex h-screen bg-[#1e293b] text-white">
      <SettingsSidebar selected={selected} onSelect={setSelected} />
      <div className="flex-1 overflow-y-auto p-6">
        {renderPanel()}
      </div>
    </div>
  );
}
