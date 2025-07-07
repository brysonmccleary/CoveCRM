import DashboardLayout from "@/components/DashboardLayout";
import LeadsPanel from "@/components/LeadsPanel";

export default function LeadsPage() {
  return (
    <DashboardLayout>
      <div className="bg-[#1e293b] text-white min-h-screen p-6 rounded-xl shadow">
        <LeadsPanel />
      </div>
    </DashboardLayout>
  );
}
