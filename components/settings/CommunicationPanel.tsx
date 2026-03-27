// components/settings/CommunicationPanel.tsx
// Default SMS number has been moved to the Numbers page
import Link from "next/link";

export default function CommunicationPanel() {
  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-white">Communication Settings</h2>
      <div className="bg-[#0f172a] rounded-xl border border-white/10 p-5">
        <p className="text-gray-300 text-sm">
          Your default SMS number can be managed from the{" "}
          <Link href="/numbers" className="text-blue-400 hover:underline">
            Numbers tab
          </Link>
          . Select which number sends outbound SMS by default directly on that page.
        </p>
      </div>
    </div>
  );
}
