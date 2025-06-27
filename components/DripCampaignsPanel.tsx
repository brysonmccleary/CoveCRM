import React from "react";

interface DripCampaignsPanelProps {
  userEmail: string;
}

export default function DripCampaignsPanel({ userEmail }: DripCampaignsPanelProps) {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Drip Campaigns</h2>
      {/* TODO: render campaign list and controls for {userEmail} */}
    </div>
  );
}

