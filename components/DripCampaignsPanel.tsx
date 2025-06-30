import { useState, useEffect } from "react";

interface Step {
  day: number;
  message: string;
}

interface Template {
  id: string;
  name: string;
  steps: Step[];
}

export default function DripCampaignsPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [editingSteps, setEditingSteps] = useState<Step[]>([]);

  useEffect(() => {
    fetch("/api/getDripTemplates")
      .then((res) => res.json())
      .then((data) => setTemplates(data));
  }, []);

  const handleSelect = (template: Template) => {
    setSelectedTemplate(template);
    setEditingSteps(template.steps);
  };

  const handleStepChange = (index: number, value: string) => {
    const updated = [...editingSteps];
    updated[index].message = value;
    setEditingSteps(updated);
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
      <h2 className="text-xl font-bold mb-4">Drip Campaign Templates</h2>

      <div className="space-y-2 mb-6">
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => handleSelect(template)}
            className={`block w-full text-left border px-3 py-2 rounded ${
              selectedTemplate?.id === template.id ? "bg-blue-600 text-white" : ""
            }`}
          >
            {template.name}
          </button>
        ))}
      </div>

      {selectedTemplate && (
        <div>
          <h3 className="font-bold mb-2">Edit Steps for: {selectedTemplate.name}</h3>
          {editingSteps.map((step, idx) => (
            <div key={idx} className="mb-3">
              <p className="text-sm mb-1">Day {step.day}</p>
              <textarea
                value={step.message}
                onChange={(e) => handleStepChange(idx, e.target.value)}
                className="w-full border p-2 rounded"
              />
            </div>
          ))}
          <button className="mt-4 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
            Save Changes (coming soon)
          </button>
        </div>
      )}
    </div>
  );
}

