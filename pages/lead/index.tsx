// /pages/lead/index.tsx
import { useState } from "react";
import { useRouter } from "next/router";
import LeadSearch from "@/components/LeadSearch";
import FoldersList from "@/components/FoldersList";
import LeadPreviewPanel from "@/components/LeadPreviewPanel";

export default function LeadsPage() {
  const router = useRouter();
  const [previewLead, setPreviewLead] = useState<any | null>(null);

  return (
    <div className="p-4 text-white">
      <h1 className="text-2xl font-bold mb-4">Lead Folders</h1>

      {/* Global search is allowed to call /api/leads/search */}
      <LeadSearch />

      {/* Folder click -> go to strict folder view */}
      <FoldersList
        onFolderSelect={(folderId: string) =>
          router.push({ pathname: "/leads", query: { folderId } }).catch(() => {})
        }
      />

      {previewLead && (
        <LeadPreviewPanel
          lead={previewLead}
          onClose={() => setPreviewLead(null)}
          onSaveNotes={async (notes: string) => {
            if (!previewLead?._id) return;
            const res = await fetch(`/api/update-lead-notes`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ leadId: previewLead._id, notes }),
            });
            if (!res.ok) alert("Failed to save notes");
            else alert("Notes saved!");
          }}
          onDispositionChange={async (dispo: string) => {
            if (!previewLead?._id || !dispo) return;
            await fetch("/api/disposition-lead", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                leadId: previewLead._id,
                newFolderName: dispo,
              }),
            }).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
