import React from "react";

interface PowerDialerPanelProps {
  leads: { _id: string; name: string; email: string; phone?: string }[];
}

export default function PowerDialerPanel({ leads }: PowerDialerPanelProps) {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Power Dialer</h2>
      {/* TODO: render your dialer queue here */}
      <p>{leads.length} leads queued for dialing.</p>
    </div>
  );
}

