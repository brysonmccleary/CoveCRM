import React from "react";

interface ConversationsPanelProps {
  userEmail: string;
}

export default function ConversationsPanel({ userEmail }: ConversationsPanelProps) {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Conversations</h2>
      {/* TODO: show message threads for {userEmail} */}
    </div>
  );
}

