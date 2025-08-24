import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import DashboardLayout from "@/components/DashboardLayout";
import CallsList from "@/components/CallsList";

const CallDetailCard = dynamic(() => import("@/components/CallDetailCard"), { ssr: false });

export default function CallsIdPage() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userHasAI, setUserHasAI] = useState<boolean>(false);

  // Pick up the dynamic route param (/calls/[id])
  useEffect(() => {
    if (!router.isReady) return;
    const rid = (router.query.id as string) || null;
    setSelectedId(rid);
  }, [router.isReady, router.query.id]);

  // Feature flag: does this user have AI?
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
              onSelect={(id) => {
                setSelectedId(id);
                // keep the URL in sync as the user navigates within the list
                if (id) router.replace(`/calls/${id}`, undefined, { shallow: true });
              }}
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
