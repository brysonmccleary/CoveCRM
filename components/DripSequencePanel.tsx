import { useState, useEffect } from "react";

interface Sequence {
  id: string;
  name: string;
  steps: string[];
  active: boolean;
}

export default function DripSequencePanel() {
  const [sequences, setSequences] = useState<Sequence[]>([]);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("sequences") || "[]");
    setSequences(saved);
  }, []);

  const toggleSequence = (id: string) => {
    const updated = sequences.map((seq) =>
      seq.id === id ? { ...seq, active: !seq.active } : seq
    );
    setSequences(updated);
    localStorage.setItem("sequences", JSON.stringify(updated));
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
      <h2 className="text-xl font-bold mb-4">Sequences</h2>
      <p className="mb-4">Create and manage your automated outreach sequences below. Toggle them on to start or off to pause.</p>

      {sequences.length === 0 ? (
        <p>No sequences found. Create some first!</p>
      ) : (
        <ul className="space-y-3">
          {sequences.map((seq) => (
            <li key={seq.id} className="border p-3 rounded flex justify-between items-center">
              <div>
                <h3 className="font-semibold">{seq.name}</h3>
                <p className="text-sm text-gray-500">{seq.steps.length} steps</p>
              </div>
              <button
                onClick={() => toggleSequence(seq.id)}
                className={`px-3 py-1 rounded text-white ${seq.active ? "bg-green-600 hover:bg-green-700" : "bg-gray-500 hover:bg-gray-600"}`}
              >
                {seq.active ? "Active" : "Inactive"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

