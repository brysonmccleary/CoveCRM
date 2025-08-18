// /pages/lead/index.tsx
import { useState } from "react";
import { useRouter } from "next/router";
import LeadSearch from "@/components/leads/LeadSearch";
import FoldersList from "@/components/FoldersList";
import LeadPreviewPanel from "@/components/LeadPreviewPanel";

export default function LeadsPage() {
  const router = useRouter();
  const [previewLead, setPreviewLead] = useState<any | null>(null);

  return (
    <div className="p-4 text-white">
      <h1 className="text-2xl font-bold mb-4">Lead Folders</h1>

      {/* Global Lead Search – clicking opens /lead/[id] */}
      <LeadSearch />

      {/* Folders list (your existing component). If it emits onLeadClick/onLeadPreview, we use them.
         If not, it will still render fine. */}
      <FoldersList
        onFolderSelect={() => {}}
        // If your FoldersList supports these, they’ll work; if not, they’re ignored at compile time.
        // onLeadClick={(lead: any) => {
        //   const id = lead?._id || lead?.id;
        //   if (id) router.push(`/lead/${id}`);
        // }}
        // onLeadPreview={(lead: any) => setPreviewLead(lead)}
      />

      {/* Our LeadPreviewPanel default export is the redirect stub; if preview is triggered, it goes to /lead/[id] */}
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
