import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import LeadImportPanel from "../components/LeadImportPanel";
import PowerDialerPanel from "../components/PowerDialerPanel";
import DripCampaignsPanel from "../components/DripCampaignsPanel";
import ConversationsPanel from "../components/ConversationsPanel";
import SettingsPanel from "../components/SettingsPanel";
// You can create placeholders for Sequences, Phone Numbers, Team Activity panels

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState("Leads");

  const renderPanel = () => {
    switch (activeTab) {
      case "Leads":
        return <LeadImportPanel csvData={{ headers: [], rows: [] }} />;
      case "Power Dialer":
        return <PowerDialerPanel />;
      case "Drip Campaigns":
        return <DripCampaignsPanel />;
      case "Conversations":
        return <ConversationsPanel />;
      case "Settings":
        return <SettingsPanel />;
      // Add more cases for "Sequences", "Phone Numbers", "Team Activity"
      default:
        return <div>Coming soon!</div>;
    }
  };

  return (
    <DashboardLayout activeTab={activeTab} setActiveTab={setActiveTab}>
      {renderPanel()}
    </DashboardLayout>
  );
}

