// /pages/lead/index.tsx
import { useState } from "react";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import LeadSearch from "@/components/LeadSearch";
import FoldersList from "@/components/FoldersList";
import LeadPreviewPanel from "@/components/LeadPreviewPanel";
import SaleModal from "@/components/SaleModal";

export default function LeadsPage() {
  const router = useRouter();
  const [previewLead, setPreviewLead] = useState<any | null>(null);
  const [showSaleModal, setShowSaleModal] = useState(false);

  return (
    <div className="p-4 text-white">
      <h1 className="text-2xl font-bold mb-4">Lead Folders</h1>

      <LeadSearch />

      <FoldersList onFolderSelect={() => {}} />

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

            // Intercept Sold → require premium (or explicit "pending") before committing
            if (dispo === "Sold") {
              setShowSaleModal(true);
              return;
            }

            try {
              const res = await fetch("/api/disposition-lead", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  leadId: previewLead._id,
                  newFolderName: dispo,
                }),
              });
              const data = await res.json().catch(() => ({} as any));
              if (!res.ok || !data?.success) {
                toast.error(data?.message || "Failed to update disposition");
              }
            } catch (e: any) {
              toast.error(e?.message || "Failed to update disposition");
            }
          }}
        />
      )}

      {showSaleModal && previewLead && (
        <SaleModal
          leadId={String(previewLead._id || "")}
          onSave={async (result) => {
            const leadId = String(previewLead._id || "");
            setShowSaleModal(false);
            try {
              const saleRes = await fetch("/api/leads/record-sale", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId, ...result }),
              });
              if (!saleRes.ok) {
                const d = await saleRes.json().catch(() => ({}));
                toast.error((d as any)?.error || "Failed to record sale");
                return;
              }
              const res = await fetch("/api/disposition-lead", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId, newFolderName: "Sold" }),
              });
              const data = await res.json().catch(() => ({} as any));
              if (!res.ok || !data?.success) {
                toast.error(data?.message || "Failed to move lead to Sold");
                return;
              }
              toast.success(`Moved to ${data?.folderName || "Sold"}`);
              setPreviewLead(null);
            } catch (e: any) {
              toast.error(e?.message || "Failed to save sale");
            }
          }}
          onMarkPending={async () => {
            const leadId = String(previewLead._id || "");
            setShowSaleModal(false);
            try {
              const res = await fetch("/api/disposition-lead", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId, newFolderName: "Sold", premiumPending: true }),
              });
              const data = await res.json().catch(() => ({} as any));
              if (!res.ok || !data?.success) {
                toast.error(data?.message || "Failed to mark lead as Sold");
                return;
              }
              toast.success(`Moved to ${data?.folderName || "Sold"} — premium pending`);
              setPreviewLead(null);
            } catch (e: any) {
              toast.error(e?.message || "Failed to mark lead as Sold");
            }
          }}
          onCancel={() => setShowSaleModal(false)}
        />
      )}
    </div>
  );
}
