// pages/calls.tsx
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import DashboardLayout from "@/components/DashboardLayout";
import CallsList from "@/components/CallsList";

const CallDetailCard = dynamic(() => import("@/components/CallDetailCard"), { ssr: false });

export default function CallsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userHasAI, setUserHasAI] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      const id = u.searchParams.get("id");
      if (id) setSelectedId(id);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/account/features", { cache: "no-store" });
        const j = await r.json();
        if (r.ok) setUserHasAI(Boolean(j?.aiCalls));
      } catch {
        setUserHasAI(false);
      }
    })();
  }, []);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Calls</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-1">
            <CallsList
              selectedId={selectedId || undefined}
              onSelect={(id) => setSelectedId(id)}
              pageSize={50}
            />
          </div>

          <div className="md:col-span-2">
            {selectedId ? (
              <CallDetailCard callId={selectedId} userHasAI={userHasAI} />
            ) : (
              <div className="bg-[#0b1220] border border-white/10 rounded-xl p-6 text-white">
                <div className="text-sm text-gray-300">
                  Select a call from the list to view details.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
