export default function ConversationsPanel() {
  const messages = [];

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
      <h2 className="text-lg font-bold mb-2">Conversations</h2>
      {messages.length === 0 ? (
        <p>No conversations yet.</p>
      ) : (
        <ul>
          {messages.map((m, idx) => (
            <li key={idx}>{m.content}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

