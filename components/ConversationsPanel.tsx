import React, { useState } from "react";

interface Conversation {
  id: number;
  name: string;
  lastMessage: string;
}

export default function ConversationsPanel() {
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: 1, name: "John Doe", lastMessage: "Interested in policy options." },
    { id: 2, name: "Jane Smith", lastMessage: "Asked for a call back tomorrow." },
    { id: 3, name: "Bob Johnson", lastMessage: "Sent additional documents." },
  ]);

  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [reply, setReply] = useState("");

  const handleReply = () => {
    alert(`Reply sent to ${selectedConv?.name}: ${reply}`);
    setReply("");
  };

  return (
    <div className="border p-4 mt-4 flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4">
      {/* Left: List */}
      <div className="w-full md:w-1/3 border p-2 rounded">
        <h3 className="text-lg font-semibold mb-2">Conversations</h3>
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`border p-2 mb-2 rounded cursor-pointer ${selectedConv?.id === conv.id ? "bg-gray-200" : ""}`}
            onClick={() => setSelectedConv(conv)}
          >
            <p className="font-bold">{conv.name}</p>
            <p className="text-sm text-gray-600">{conv.lastMessage}</p>
          </div>
        ))}
      </div>

      {/* Right: Reply */}
      <div className="w-full md:w-2/3 border p-2 rounded">
        {selectedConv ? (
          <>
            <h3 className="text-lg font-semibold mb-2">Reply to {selectedConv.name}</h3>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type your reply..."
              className="border p-2 w-full h-32 rounded"
            />
            <button
              onClick={handleReply}
              className="mt-2 border px-4 py-2 bg-blue-500 text-white rounded"
            >
              Send Reply
            </button>
          </>
        ) : (
          <p>Select a conversation to reply.</p>
        )}
      </div>
    </div>
  );
}

