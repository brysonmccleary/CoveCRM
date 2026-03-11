from pathlib import Path
import sys

path = Path("components/DripCampaignsPanel.tsx")
src = path.read_text(encoding="utf-8")

old_anchor = '''  const handleEditMessage = (
    dripId: string,
    index: number,
    key: "text" | "day",
    value: string,
  ) => {
    const updated = [...(editableDrips[dripId] || [])];
    if (!updated[index]) return;
    updated[index] = { ...updated[index], [key]: value };
    setEditableDrips({ ...editableDrips, [dripId]: updated });
  };

  const handleAssignDrip = (dripId: string, dripName?: string) => {
'''

new_anchor = '''  const handleEditMessage = (
    dripId: string,
    index: number,
    key: "text" | "day",
    value: string,
  ) => {
    const updated = [...(editableDrips[dripId] || [])];
    if (!updated[index]) return;
    updated[index] = { ...updated[index], [key]: value };
    setEditableDrips({ ...editableDrips, [dripId]: updated });
  };

  const handleRemoveNewStep = (index: number) => {
    setMessageSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveEditableStep = (dripId: string, index: number) => {
    const updated = [...(editableDrips[dripId] || [])].filter((_, i) => i !== index);
    setEditableDrips({ ...editableDrips, [dripId]: updated });
  };

  const handleAssignDrip = (dripId: string, dripName?: string) => {
'''

if old_anchor not in src:
    print("[refuse] handler anchor not found")
    sys.exit(1)

src = src.replace(old_anchor, new_anchor, 1)

old_new_preview = '''            {messageSteps.map((step, idx) => (
              <div key={idx} className="border border-black dark:border-white p-2 rounded">
                <p>
                  <strong>When:</strong> {step.day}
                </p>
                <p>
                  <strong>Message:</strong> {step.text}
                </p>
              </div>
            ))}'''

new_new_preview = '''            {messageSteps.map((step, idx) => (
              <div key={idx} className="border border-black dark:border-white p-2 rounded">
                <p>
                  <strong>When:</strong> {step.day}
                </p>
                <p>
                  <strong>Message:</strong> {step.text}
                </p>
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => handleRemoveNewStep(idx)}
                    className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}'''

if old_new_preview not in src:
    print("[refuse] new campaign preview block not found")
    sys.exit(1)

src = src.replace(old_new_preview, new_new_preview, 1)

old_prebuilt_editor = '''                {editableDrips[String(campaignId)]?.map((msg, idx) => (
                  <div key={idx} className="space-y-1">
                    <input
                      value={msg.day}
                      onChange={(e) =>
                        handleEditMessage(String(campaignId), idx, "day", e.target.value)
                      }
                      className="border border-black dark:border-white p-1 rounded w-32 text-sm"
                    />
                    <textarea
                      value={msg.text}
                      onChange={(e) =>
                        handleEditMessage(String(campaignId), idx, "text", e.target.value)
                      }
                      className="border border-black dark:border-white p-2 rounded w-full text-sm"
                    />
                  </div>
                ))}'''

new_prebuilt_editor = '''                {editableDrips[String(campaignId)]?.map((msg, idx) => (
                  <div key={idx} className="space-y-1">
                    <input
                      value={msg.day}
                      onChange={(e) =>
                        handleEditMessage(String(campaignId), idx, "day", e.target.value)
                      }
                      className="border border-black dark:border-white p-1 rounded w-32 text-sm"
                    />
                    <textarea
                      value={msg.text}
                      onChange={(e) =>
                        handleEditMessage(String(campaignId), idx, "text", e.target.value)
                      }
                      className="border border-black dark:border-white p-2 rounded w-full text-sm"
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleRemoveEditableStep(String(campaignId), idx)}
                        className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}'''

if old_prebuilt_editor not in src:
    print("[refuse] prebuilt editor block not found")
    sys.exit(1)

src = src.replace(old_prebuilt_editor, new_prebuilt_editor, 1)

old_custom_editor = '''              {editableDrips[camp._id]?.map((msg, idx) => (
                <div key={idx} className="space-y-1">
                  <input
                    value={msg.day}
                    onChange={(e) =>
                      handleEditMessage(camp._id, idx, "day", e.target.value)
                    }
                    className="border border-black dark:border-white p-1 rounded w-32 text-sm"
                  />
                  <textarea
                    value={msg.text}
                    onChange={(e) =>
                      handleEditMessage(camp._id, idx, "text", e.target.value)
                    }
                    className="border border-black dark:border-white p-2 rounded w-full text-sm"
                  />
                </div>
              ))}'''

new_custom_editor = '''              {editableDrips[camp._id]?.map((msg, idx) => (
                <div key={idx} className="space-y-1">
                  <input
                    value={msg.day}
                    onChange={(e) =>
                      handleEditMessage(camp._id, idx, "day", e.target.value)
                    }
                    className="border border-black dark:border-white p-1 rounded w-32 text-sm"
                  />
                  <textarea
                    value={msg.text}
                    onChange={(e) =>
                      handleEditMessage(camp._id, idx, "text", e.target.value)
                    }
                    className="border border-black dark:border-white p-2 rounded w-full text-sm"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleRemoveEditableStep(camp._id, idx)}
                      className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}'''

if old_custom_editor not in src:
    print("[refuse] custom editor block not found")
    sys.exit(1)

src = src.replace(old_custom_editor, new_custom_editor, 1)

path.write_text(src, encoding="utf-8")
print("[patch] Added delete-step buttons to drip campaign editor")
