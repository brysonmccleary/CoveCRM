import { useRouter } from "next/router";
import DripCampaignsPanel from "../components/DripCampaignsPanel";
import DashboardLayout from "@/components/DashboardLayout";
import DashboardOverview from "@/components/DashboardOverview";
import LeadsPanel from "@/components/LeadsPanel"; // ✅ Use the real LeadsPanel component

// You can keep these placeholders or build them out later
const WorkflowsPanel = () => <div className="p-4">Workflows Panel (Coming soon)</div>;
const ConversationsPanel = () => <div className="p-4">Conversations Panel (Coming soon)</div>;
const TeamActivityPanel = () => <div className="p-4">Team Activity Panel (Coming soon)</div>;
const NumbersPanel = () => <div className="p-4">Numbers Panel (Coming soon)</div>;
const SettingsPanel = () => <div className="p-4">Settings Panel (Coming soon)</div>;

export default function DashboardPage() {
  const router = useRouter();
  const { tab } = router.query;

  return (
    <DashboardLayout>
      {!tab || tab === "home" ? (
        <DashboardOverview />
      ) : null}
      {tab === "leads" && <LeadsPanel />}
      {tab === "workflows" && <WorkflowsPanel />}
      {tab === "conversations" && <ConversationsPanel />}
      {tab === "team-activity" && <TeamActivityPanel />}
      {tab === "numbers" && <NumbersPanel />}
      {tab === "settings" && <SettingsPanel />}
    </DashboardLayout>
  );
}
