// /components/DripCampaignsPanel.tsx
import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import AssignDripModal from "@/components/AssignDripModal";
import { prebuiltDrips } from "@/utils/prebuiltDrips";

interface MessageStep {
  text: string;
  day: string;
}

interface Folder {
  _id: string;
  name: string;
  assignedDrip?: string;
}

interface ApiCampaign {
  _id: string;
  name: string;
  key?: string | null;
  isActive: boolean;
  steps?: MessageStep[];
  isGlobal?: boolean;
  createdBy?: string | null;
  user?: string | null;
  userEmail?: string | null;
}

export default function DripCampaignsPanel() {
  const [campaignName, setCampaignName] = useState("");
  const [messageSteps, setMessageSteps] = useState<MessageStep[]>([]);
  const [currentText, setCurrentText] = useState("");
  const [currentDay, setCurrentDay] = useState("immediately");
  const [maxDayUsed, setMaxDayUsed] = useState(0);

  const [folders, setFolders] = useState<Folder[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [selectedDripId, setSelectedDripId] = useState<string | null>(null);

  const [expandedDrips, setExpandedDrips] = useState<Record<string, boolean>>(
    {},
  );
  const [editableDrips, setEditableDrips] = useState<
    Record<string, MessageStep[]>
  >({});

  const [backendCampaigns, setBackendCampaigns] = useState<ApiCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);

  // Resolve a UI "dripId" (prebuiltDrips.id) to an actual DB campaign _id
  // - Global prebuilt drips are seeded with key=prebuiltDrips.id
  // - User edits to global drips create a user-owned clone that keeps the same key
  const resolveDbCampaignId = (uiDripId: string, uiName?: string): string => {
    const byId = backendCampaigns.find((c) => c._id === uiDripId);
    if (byId?._id) return byId._id;

    const byKey = backendCampaigns.find((c) => String(c.key || "") === uiDripId);
    if (byKey?._id) return byKey._id;

    if (uiName) {
      const byName = backendCampaigns.find(
        (c) => String(c.name || "").trim().toLowerCase() === String(uiName).trim().toLowerCase()
      );
      if (byName?._id) return byName._id;
    }

    // Fallback: return what we were given (older deployments)
    return uiDripId;
  };


  // Precompute prebuilt names to distinguish custom campaigns
  const prebuiltNames = new Set(prebuiltDrips.map((d) => d.name));

  // Map prebuiltDrips (static list) to the best matching DB campaign (user override preferred by API).
  // seed.ts sets key = drip.id for globals; user clones keep same key.
  const prebuiltVisible = prebuiltDrips.map((d) => {
    const byKey = backendCampaigns.find((c) => String(c.key || "").trim() === d.id);
    const byName = backendCampaigns.find(
      (c) => String(c.name || "").trim().toLowerCase() === String(d.name).trim().toLowerCase()
    );
    const camp = byKey || byName || null;

    return {
      id: d.id,                 // stable prebuilt id
      name: d.name,
      defaultSteps: d.messages, // fallback static steps
      campaign: camp,           // DB campaign (global or user override)
    };
  });

  // For custom list: show only non-global campaigns that are NOT overrides of prebuilts (i.e., not matching any prebuilt key/name)
  const isPrebuiltOverride = (c: ApiCampaign) => {
    const k = String(c.key || "").trim();
    if (k && prebuiltDrips.some((d) => d.id === k)) return true;
    const n = String(c.name || "").trim().toLowerCase();
    if (n && prebuiltDrips.some((d) => String(d.name).trim().toLowerCase() === n)) return true;
    return false;
  };

  // Load folders for assignment
  useEffect(() => {
    const fetchFolders = async () => {
      try {
        const res = await axios.get("/api/folders");
        setFolders(res.data);
      } catch {
        toast.error("❌ Error fetching folders");
      }
    };
    fetchFolders();
  }, []);

  // Load campaigns (global + user-scoped) from API
  useEffect(() => {
    const fetchCampaigns = async () => {
      try {
        setLoadingCampaigns(true);
        const res = await axios.get("/api/drips/campaigns?active=1");
        const campaigns: ApiCampaign[] = res.data?.campaigns || [];
        setBackendCampaigns(campaigns);
      } catch {
        toast.error("❌ Error fetching drip campaigns");
      } finally {
        setLoadingCampaigns(false);
      }
    };
    fetchCampaigns();
  }, []);

  // ---- Step builder for new custom campaigns ----
  const addStep = () => {
    if (!currentText) return;

    const numericDay =
      currentDay === "immediately"
        ? 0
        : parseInt(currentDay.replace("Day ", ""), 10);

    const optOut = " Reply STOP to opt out.";
    const enforcedText = currentText.trim().endsWith(optOut)
      ? currentText.trim()
      : `${currentText.trim()}${optOut}`;

    setMessageSteps((prev) => [...prev, { text: enforcedText, day: currentDay }]);
    setCurrentText("");
    setCurrentDay(`Day ${numericDay + 1}`);
    setMaxDayUsed((prev) => Math.max(prev, numericDay));
  };

  const generateDayOptions = () => {
    const options: string[] = [];
    if (maxDayUsed === 0) options.push("immediately");
    const start = maxDayUsed === 0 ? 1 : maxDayUsed + 1;
    for (let i = start; i <= 365; i++) options.push(`Day ${i}`);
    return options;
  };

  const insertMergeField = (field: string) => {
    // Keep legacy <token> style so it stays compatible with existing rendering logic
    setCurrentText((prev) => `${prev} <${field}>`);
  };

  // ---- Save new custom campaign to backend ----
  const saveCampaign = async () => {
    if (!campaignName || messageSteps.length === 0) {
      toast.error("❌ Please enter a campaign name and at least one message.");
      return;
    }

    try {
      const res = await axios.post("/api/drips/campaigns", {
        name: campaignName,
        steps: messageSteps,
      });

      const created: ApiCampaign | undefined = res.data?.campaign;
      if (created?._id) {
        setBackendCampaigns((prev) => [...prev, created]);
      }

      setCampaignName("");
      setMessageSteps([]);
      setMaxDayUsed(0);
      setCurrentDay("immediately");

      toast.success("✅ Custom drip campaign saved!");
    } catch (err: any) {
      console.error("Error saving custom drip campaign", err);
      toast.error("❌ Error saving custom drip campaign");
    }
  };

  // ---- Expand / edit helpers (works for BOTH prebuilt + custom) ----
  const toggleExpand = (dripId: string) => {
    const isExpanded = expandedDrips[dripId] || false;
    setExpandedDrips((prev) => ({ ...prev, [dripId]: !isExpanded }));

    // If we don't have an editable copy loaded, seed it from either:
    // - prebuiltDrips (static)
    // - backendCampaigns (custom/global)
    if (!editableDrips[dripId]) {
      const foundPrebuilt = prebuiltVisible.find((d) => getPrebuiltUiId(d) === dripId || String(d.id) === String(dripId));
      if (foundPrebuilt) {
        const seeded = Array.isArray(foundPrebuilt.campaign?.steps) && foundPrebuilt.campaign?.steps?.length
          ? foundPrebuilt.campaign.steps.map((s: any) => ({ day: String(s.day || "immediately"), text: String(s.text || "") }))
          : (foundPrebuilt.defaultSteps || []).map((m: any) => ({ day: String(m.day || "immediately"), text: String(m.text || "") }));
        setEditableDrips((prev) => ({
          ...prev,
          [dripId]: seeded,
        }));
        return;
      }

      const foundBackend = backendCampaigns.find((c) => c._id === dripId);
      if (foundBackend) {
        const seeded = Array.isArray(foundBackend.steps)
          ? foundBackend.steps.map((s) => ({
              day: String(s.day || "immediately"),
              text: String(s.text || ""),
            }))
          : [];
        setEditableDrips((prev) => ({
          ...prev,
          [dripId]: seeded,
        }));
      }
    }
  };

  const handleEditMessage = (
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
    const resolved = resolveDbCampaignId(dripId, dripName);
    setSelectedDripId(resolved);
    setShowModal(true);
    toast.success("✅ Drip selected — now assign it!");
  };

  // Prebuilt: REAL save to backend (will clone global -> user-owned on first edit)
  const handleSavePrebuiltDrip = async (dripId: string, dripName?: string) => {
    const steps = editableDrips[dripId] || [];
    if (!Array.isArray(steps) || steps.length === 0) {
      toast.error("❌ Add at least one message before saving.");
      return;
    }

    // Enforce opt-out on every message (same rule as builder)
    const optOut = " Reply STOP to opt out.";
    const normalized = steps.map((s) => {
      const day = String(s.day || "immediately");
      const textRaw = String(s.text || "").trim();
      const text = textRaw.endsWith(optOut) ? textRaw : `${textRaw}${optOut}`;
      return { day, text };
    });

    try {
      const dbId = resolveDbCampaignId(dripId, dripName);
      const res = await axios.put(`/api/drips/${dbId}`, { steps: normalized });

      const updated = res.data || {};
      const newId = String(updated._id || dbId);

      // Keep backendCampaigns in sync (insert or replace)
      setBackendCampaigns((prev) => {
        const exists = prev.some((c) => c._id === newId);
        const next = exists
          ? prev.map((c) =>
              c._id === newId
                ? { ...c, ...updated, steps: Array.isArray(updated.steps) ? updated.steps : normalized }
                : c
            )
          : [...prev, { ...(updated || {}), _id: newId } as any];

        // Also remove the old record if it was a global one we just cloned from
        return next.filter((c) => c._id !== dbId || c._id === newId);
      });

      // If clone-on-edit returned a new _id, remap local state keys so the UI keeps working
      if (newId !== dripId) {
        setExpandedDrips((prev) => {
          const v = !!prev[dripId];
          const copy = { ...prev };
          delete copy[dripId];
          copy[newId] = v;
          return copy;
        });

        setEditableDrips((prev) => {
          const copy = { ...prev };
          copy[newId] = normalized;
          delete copy[dripId];
          return copy;
        });
      } else {
        // Ensure editable reflects what we saved
        setEditableDrips((prev) => ({ ...prev, [dripId]: normalized }));
      }

      toast.success("✅ Prebuilt drip saved to your CRM!");
    } catch (err: any) {
      console.error("Error saving prebuilt drip campaign", err);
      toast.error("❌ Error saving drip campaign");
    }
  };

  // Prebuilt: delete ONLY the user-owned override (global cannot be deleted)
  const handleDeletePrebuiltDrip = async (dripId: string, dripName?: string) => {
    if (!confirm("Remove your customized version of this prebuilt drip?")) return;

    try {
      const dbId = resolveDbCampaignId(dripId, dripName);

      // If we don't have a db campaign loaded, just clear local edits
      const dbCamp = backendCampaigns.find((c) => c._id === dbId);

      // If it's global (or unknown), we cannot delete it — only clear local UI edits
      if (dbCamp?.isGlobal) {
        const newExpanded = { ...expandedDrips };
        const newEditable = { ...editableDrips };
        delete newExpanded[dripId];
        delete newEditable[dripId];
        setExpandedDrips(newExpanded);
        setEditableDrips(newEditable);
        toast.success("✅ Cleared local edits (global prebuilt cannot be deleted).");
        return;
      }

      await axios.delete(`/api/drips/${dbId}`);

      setBackendCampaigns((prev) => prev.filter((c) => c._id !== dbId));

      const newExpanded = { ...expandedDrips };
      const newEditable = { ...editableDrips };
      delete newExpanded[dripId];
      delete newEditable[dripId];
      delete newExpanded[dbId];
      delete newEditable[dbId];
      setExpandedDrips(newExpanded);
      setEditableDrips(newEditable);

      toast.success("🗑️ Your customized drip was removed!");
    } catch (err: any) {
      console.error("Error deleting prebuilt override", err);
      toast.error("❌ Could not delete drip (global prebuilt cannot be deleted).");
    }
  };

  // Custom: REAL save to backend (user-scoped in API)
  const handleSaveCustomDrip = async (dripId: string) => {
    const steps = editableDrips[dripId] || [];

    if (!Array.isArray(steps) || steps.length === 0) {
      toast.error("❌ Add at least one message before saving.");
      return;
    }

    // Enforce opt-out on every message (same rule as builder)
    const optOut = " Reply STOP to opt out.";
    const normalized = steps.map((s) => {
      const day = String(s.day || "immediately");
      const textRaw = String(s.text || "").trim();
      const text = textRaw.endsWith(optOut) ? textRaw : `${textRaw}${optOut}`;
      return { day, text };
    });

    try {
      const res = await axios.put(`/api/drips/${dripId}`, { steps: normalized });

      // Keep UI in sync with backend response
      const updated = res.data;
      

      // ✅ If backend cloned a GLOBAL drip into a user-owned drip, adopt the new _id everywhere.
      try {
        const newId = String((updated as any)?._id || "");
        const oldId = String(dripId || "");
        if (newId && oldId && newId !== oldId) {
          // migrate editableDrips keys
          setEditableDrips((prev: any) => {
            const next = { ...(prev || {}) };
            if (next[oldId] && !next[newId]) next[newId] = next[oldId];
            delete next[oldId];
            return next;
          });
          // migrate expandedDrips keys
          setExpandedDrips((prev: any) => {
            const next = { ...(prev || {}) };
            if (next[oldId] && !next[newId]) next[newId] = next[oldId];
            delete next[oldId];
            return next;
          });
          // migrate selectedDripId (if user is editing currently selected one)
          setSelectedDripId((cur: any) => (String(cur || "") === oldId ? newId : cur));
        }
      } catch (e) {
        console.warn("adopt-new-id failed (non-fatal)", e);
      }
      const newId = String(updated?._id || "");
      if (newId && newId !== dripId) {
        // clone happened: remap UI state to the new _id
        setExpandedDrips((prev) => {
          const next: Record<string, boolean> = { ...prev };
          if (next[dripId] !== undefined) {
            next[newId] = next[dripId];
            delete next[dripId];
          }
          return next;
        });

        setEditableDrips((prev) => {
          const next: Record<string, MessageStep[]> = { ...prev };
          if (next[dripId]) {
            next[newId] = next[dripId];
            delete next[dripId];
          }
          return next;
        });

        setBackendCampaigns((prev) => {
          const withoutOld = prev.filter((c) => String(c._id) !== String(dripId));
          const already = withoutOld.some((c) => String(c._id) === newId);
          return already ? withoutOld : [...withoutOld, updated];
        });
      } else {
        // normal update-in-place
        setBackendCampaigns((prev) =>
          prev.map((c) =>
            String(c._id) === String(dripId) ? { ...c, ...updated } : c,
          ),
        );
      }

setBackendCampaigns((prev) =>
        prev.map((c) =>
          c._id === dripId
            ? {
                ...c,
                steps: Array.isArray(updated?.steps) ? updated.steps : normalized,
              }
            : c,
        ),
      );

      // Ensure editable reflects what we saved
      setEditableDrips((prev) => ({
        ...prev,
        [dripId]: normalized,
      }));

      toast.success("✅ Custom drip updated!");
    } catch (err: any) {
      console.error("Error saving custom drip campaign", err);
      toast.error("❌ Error saving custom drip campaign");
    }
  };

  // Custom: REAL delete (user-scoped in API)
  const handleDeleteCustomDrip = async (dripId: string) => {
    if (!confirm("Delete this custom drip campaign? This cannot be undone.")) return;

    try {
      await axios.delete(`/api/drips/${dripId}`);

      setBackendCampaigns((prev) => prev.filter((c) => c._id !== dripId));

      const newExpanded = { ...expandedDrips };
      const newEditable = { ...editableDrips };
      delete newExpanded[dripId];
      delete newEditable[dripId];
      setExpandedDrips(newExpanded);
      setEditableDrips(newEditable);

      toast.success("🗑️ Custom drip deleted!");
    } catch (err: any) {
      console.error("Error deleting custom drip campaign", err);
      toast.error("❌ Error deleting custom drip campaign");
    }
  };

  const handleAssignConfirm = async (folderId: string) => {
    if (!selectedDripId) return;
    try {
      const res = await axios.post("/api/assign-drip-to-folder", {
        dripId: selectedDripId,
        folderId,
      });
      if (res.status === 200) {
        toast.success("✅ Drip assigned successfully!");
        setShowModal(false);
        setSelectedDripId(null);
      } else {
        toast.error("❌ Error assigning drip");
      }
    } catch {
      toast.error("❌ Error assigning drip");
    }
  };

  // ---- Custom campaigns derived from backend data ----
    const customCampaigns: ApiCampaign[] = backendCampaigns.filter((c) => !c.isGlobal && !isPrebuiltOverride(c));


  const getPrebuiltUiId = (d: any) => String(d?.campaign?._id || d?.id);

  const savePrebuiltToBackend = async (d: any) => {
    const uiId = getPrebuiltUiId(d);
    const steps = editableDrips[uiId] || [];

    if (!d?.campaign?._id) {
      toast.error("❌ Prebuilt drip not loaded from DB yet. Refresh the page.");
      return;
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      toast.error("❌ Add at least one message before saving.");
      return;
    }

    // Enforce opt-out on every message
    const optOut = " Reply STOP to opt out.";
    const normalized = steps.map((s: any) => {
      const day = String(s.day || "immediately");
      const textRaw = String(s.text || "").trim();
      const text = textRaw.endsWith(optOut) ? textRaw : `${textRaw}${optOut}`;
      return { day, text };
    });

    try {
      const res = await axios.put(`/api/drips/${d.campaign._id}`, { steps: normalized });

      const updated = res.data || {};
      const newId = String(updated._id || d.campaign._id);

      // Refresh campaigns from API so merged list shows the override after clone-on-edit
      const refreshed = await axios.get(`/api/drips/campaigns?active=1&t=${Date.now()}`);
      setBackendCampaigns(refreshed.data?.campaigns || []);

      // If clone occurred, move editable state to new id
      if (newId !== String(d.campaign._id)) {
        setEditableDrips((prev: any) => {
          const next = { ...prev };
          next[newId] = normalized;
          delete next[uiId];
          return next;
        });
        setExpandedDrips((prev: any) => {
          const next = { ...prev };
          next[newId] = true;
          delete next[uiId];
          return next;
        });
      } else {
        setEditableDrips((prev: any) => ({ ...prev, [uiId]: normalized }));
      }

      toast.success("✅ Prebuilt drip saved to your account!");
    } catch (err) {
      console.error("Error saving prebuilt drip", err);
      toast.error("❌ Error saving prebuilt drip");
    }
  };

  const assignPrebuilt = (d: any) => {
    if (!d?.campaign?._id) {
      toast.error("❌ Prebuilt drip not loaded from DB yet. Refresh the page.");
      return;
    }
    setSelectedDripId(String(d.campaign._id));
    setShowModal(true);
    toast.success("✅ Drip selected — now assign it!");
  };

  return (
    <div className="p-4 space-y-6">
      {/* Creator */}
      <div className="border border-black dark:border-white p-4 rounded">
        <h2 className="text-xl font-bold mb-2">Create Custom Drip Campaign</h2>
        <input
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          placeholder="Campaign Name"
          className="border border-black dark:border-white p-2 w-full rounded mb-2"
        />

        <div className="mb-2 space-x-2">
          <button
            onClick={() => insertMergeField("client_first_name")}
            className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600"
          >
            Insert Client First Name
          </button>
          <button
            onClick={() => insertMergeField("agent_name")}
            className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600"
          >
            Insert Agent Name
          </button>
          <button
            onClick={() => insertMergeField("agent_phone")}
            className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600"
          >
            Insert Agent Phone
          </button>
          <button
            onClick={() => insertMergeField("folder_name")}
            className="text-xs bg-gray-700 text-white px-2 py-1 rounded hover:bg-gray-600"
          >
            Insert Folder Name
          </button>
        </div>

        <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2">
          <input
            value={currentText}
            onChange={(e) => setCurrentText(e.target.value)}
            placeholder="Message text"
            className="border border-black dark:border-white p-2 flex-1 rounded"
          />
          <select
            value={currentDay}
            onChange={(e) => setCurrentDay(e.target.value)}
            className="border border-black dark:border-white p-2 rounded"
          >
            {generateDayOptions().map((day, idx) => (
              <option key={idx} value={day}>
                {day}
              </option>
            ))}
          </select>
          <button
            onClick={addStep}
            className="border border-black dark:border-white px-4 rounded cursor-pointer"
          >
            Add
          </button>
        </div>

        {messageSteps.length > 0 && (
          <div className="space-y-2 mt-2">
            <h3 className="font-semibold">Messages in Campaign:</h3>
            {messageSteps.map((step, idx) => (
              <div key={idx} className="border border-black dark:border-white p-2 rounded">
                <p>
                  <strong>When:</strong> {step.day}
                </p>
                <p>
                  <strong>Message:</strong> {step.text}
                </p>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={saveCampaign}
          className="mt-2 border border-black dark:border-white px-4 py-2 rounded cursor-pointer"
        >
          Save Campaign
        </button>
      </div>

      {/* Prebuilt Drips */}
      <h2 className="text-xl font-bold mt-8">Prebuilt Drip Campaigns</h2>
      {prebuiltVisible.map((d) => {
        const campaignId = d.campaign?._id;
        if (!campaignId) return null; // not seeded / missing DB campaign

        return (
          <div
            key={String(campaignId)}
            className="border border-black dark:border-white p-3 rounded mb-4"
          >
            <div className="flex justify-between items-center">
              <button
                onClick={() => toggleExpand(String(campaignId))}
                className="text-left font-semibold text-lg cursor-pointer"
              >
                {d.name} — {(d.campaign?.steps || d.defaultSteps || []).length} messages
              </button>
              <button
                onClick={() => handleAssignDrip(String(campaignId), d.name)}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm cursor-pointer"
              >
                Assign to Folder/Leads
              </button>
            </div>

            {expandedDrips[String(campaignId)] && (
              <div className="mt-4 space-y-3">
                {editableDrips[String(campaignId)]?.map((msg, idx) => (
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
                ))}

                <div className="flex space-x-2 pt-2">
                  <button
                    onClick={() => handleSaveCustomDrip(String(campaignId))}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded cursor-pointer"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}


      {/* Custom Campaigns from backend (NOW expandable + editable like prebuilt) */}
      <h2 className="text-xl font-bold mt-8">
        Your Custom Campaigns{" "}
        {loadingCampaigns && (
          <span className="text-sm font-normal text-gray-400">(loading…)</span>
        )}
      </h2>
      {customCampaigns.length === 0 && !loadingCampaigns && (
        <p className="text-sm text-gray-400">
          You don&apos;t have any custom drip campaigns yet.
        </p>
      )}

      {customCampaigns.map((camp) => (
        <div
          key={camp._id}
          className="border border-black dark:border-white p-3 rounded mb-4"
        >
          <div className="flex justify-between items-center">
            <button
              onClick={() => toggleExpand(camp._id)}
              className="text-left font-semibold text-lg cursor-pointer"
            >
              {camp.name} — {(camp.steps || []).length} messages
            </button>
            <button
              onClick={() => handleAssignDrip(camp._id)}
              className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm cursor-pointer"
            >
              Assign to Folder/Leads
            </button>
          </div>

          {expandedDrips[camp._id] && (
            <div className="mt-4 space-y-3">
              {editableDrips[camp._id]?.map((msg, idx) => (
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
              ))}

              <div className="flex space-x-2 pt-2">
                <button
                  onClick={() => handleSaveCustomDrip(camp._id)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded cursor-pointer"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => handleDeleteCustomDrip(camp._id)}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded cursor-pointer"
                >
                  Delete Drip
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Assign Drip Modal */}
      {showModal && selectedDripId && (
        <AssignDripModal
          dripId={selectedDripId}
          folders={folders}
          onClose={() => {
            setShowModal(false);
            setSelectedDripId(null);
          }}
          onAssign={handleAssignConfirm}
        />
      )}
    </div>
  );
}
