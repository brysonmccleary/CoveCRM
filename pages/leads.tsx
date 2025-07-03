import DashboardLayout from "@/components/DashboardLayout";
import LeadsPanel from "@/components/LeadsPanel";

export default function LeadsPage() {
  return (
    <DashboardLayout>
      <div className="bg-[#0c1b2f] text-white min-h-screen p-6">
        <LeadsPanel />
      </div>
    </DashboardLayout>
  );
}

