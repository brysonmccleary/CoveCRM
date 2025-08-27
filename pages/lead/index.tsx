// /pages/lead/index.tsx
import LeadSearch from "@/components/LeadSearch";
import FoldersList from "@/components/FoldersList";

export default function LeadLanding() {
  return (
    <div className="p-4 text-white">
      <h1 className="text-2xl font-bold mb-4">Lead Folders</h1>
      {/* Global search (opens /lead/[id]) */}
      <LeadSearch />
      {/* Clicking a folder will navigate to /leads?folderId=... */}
      <FoldersList />
    </div>
  );
}
