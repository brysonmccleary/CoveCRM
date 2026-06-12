// /components/DripCampaignsPanel.tsx
import { useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useSession } from "next-auth/react";
import AssignDripModal from "@/components/AssignDripModal";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import EmailCampaignsPanel from "@/components/EmailCampaignsPanel";

const EXPERIMENTAL_ADMIN = "bryson.mccleary1@gmail.com";

type DripTabMode = "sms" | "email";

type DripDelayUnit = "hours" | "days" | "weeks" | "months";

interface MessageStep {
  text: string;
  day: string;
  delayValue?: number;
  delayUnit?: DripDelayUnit;
}

// ── Delay helpers ────────────────────────────────────────────────────────────

function parseLegacyDayUI(day?: string | null): { value: number; unit: DripDelayUnit } {
  if (!day) return { value: 0, unit: "days" };
  const raw = String(day).trim().toLowerCase();
  if (raw === "immediately" || raw === "immediate" || raw === "day 0" || raw === "0") {
    return { value: 0, unit: "days" };
  }
  const monthM = raw.match(/(?:months?\s+(\d+)|(\d+)\s+months?)/);
  if (monthM) { const n = parseInt(monthM[1] || monthM[2], 10); if (!isNaN(n)) return { value: n, unit: "months" }; }
  const weekM = raw.match(/(?:weeks?\s+(\d+)|(\d+)\s+weeks?)/);
  if (weekM) { const n = parseInt(weekM[1] || weekM[2], 10); if (!isNaN(n)) return { value: n, unit: "weeks" }; }
  const hourM = raw.match(/(?:hours?\s+(\d+)|(\d+)\s+hours?)/);
  if (hourM) { const n = parseInt(hourM[1] || hourM[2], 10); if (!isNaN(n)) return { value: n, unit: "hours" }; }
  const dayM = raw.match(/(?:days?\s+(\d+)|(\d+)\s+days?|^day\s+(\d+)$|^(\d+)$)/);
  if (dayM) { const n = parseInt(dayM[1] || dayM[2] || dayM[3] || dayM[4], 10); if (!isNaN(n)) return { value: n, unit: "days" }; }
  return { value: 1, unit: "days" };
}

function delayToLegacyDay(value: number, unit: DripDelayUnit): string {
  if (value === 0 && unit === "days") return "immediately";
  if (unit === "hours") return `${value} hours`;
  if (unit === "days") return `Day ${value}`;
  if (unit === "weeks") return `Week ${value}`;
  if (unit === "months") return `Month ${value}`;
  return `Day ${value}`;
}

function isBirthdayStep(day?: string | null): boolean {
  return /birthday/i.test(String(day || ""));
}

function stepDelayLabel(step: MessageStep): string {
  if (isBirthdayStep(step.day)) return "Birthday (disabled)";
  const v = step.delayValue ?? parseLegacyDayUI(step.day).value;
  const u = step.delayUnit ?? parseLegacyDayUI(step.day).unit;
  if (v === 0 && u === "days") return "Immediately";
  return `${v} ${u} after enrollment`;
}

function normalizeStep(s: any): MessageStep {
  const day = String(s.day || "immediately");
  if (s.delayValue != null && s.delayUnit) {
    return { text: String(s.text || ""), day, delayValue: Number(s.delayValue), delayUnit: s.delayUnit as DripDelayUnit };
  }
  const parsed = parseLegacyDayUI(day);
  return { text: String(s.text || ""), day, delayValue: parsed.value, delayUnit: parsed.unit };
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
  const { data: session } = useSession();
  const isAdmin = (session?.user?.email ?? "").toLowerCase() === EXPERIMENTAL_ADMIN;
  const [dripTab, setDripTab] = useState<DripTabMode>("sms");
  const [campaignName, setCampaignName] = useState("");

  // AI Builder state
  const [showAIBuilder, setShowAIBuilder] = useState(false);
  const [aiScenario, setAIScenario] = useState("");
  const [aiType, setAIType] = useState<"sms" | "email">("sms");
  const [aiStepCount, setAIStepCount] = useState(5);
  const [aiBuilding, setAIBuilding] = useState(false);
  const [aiDescription, setAIDescription] = useState("");
  // AI Preview state (edit-before-save)
  const [aiPreviewName, setAIPreviewName] = useState("");
  const [aiPreviewSteps, setAIPreviewSteps] = useState<MessageStep[]>([]);
  const [aiPreviewSaving, setAIPreviewSaving] = useState(false);

  const buildWithAI = async () => {
    if (!aiScenario.trim()) { toast.error("Describe the lead scenario first"); return; }
    setAIBuilding(true);
    setAIDescription("");
    setAIPreviewName("");
    setAIPreviewSteps([]);
    try {
      const res = await axios.post("/api/ai/explain-drip", {
        scenario: aiScenario,
        type: aiType,
        stepCount: aiStepCount,
      });
      const { campaignName: generatedName, description, steps } = res.data;
      if (!Array.isArray(steps) || steps.length === 0) { toast.error("AI returned no steps. Try again."); return; }
      const filled: MessageStep[] = steps.map((s: any) => normalizeStep({
        day: s.day === 0 ? "immediately" : `Day ${s.day}`,
        text: String(s.text || ""),
      }));
      setAIPreviewName(generatedName || "");
      setAIPreviewSteps(filled);
      setAIDescription(description || "");
      toast.success("Campaign generated! Review and edit below, then save.");
      setShowAIBuilder(false);
    } catch {
      toast.error("AI build failed. Try again.");
    } finally {
      setAIBuilding(false);
    }
  };

  const saveAIPreview = async () => {
    if (!aiPreviewName.trim() || aiPreviewSteps.length === 0) {
      toast.error("❌ Campaign name and at least one step are required.");
      return;
    }
    setAIPreviewSaving(true);
    try {
      const normalized = aiPreviewSteps.map((s) => {
        const dv = s.delayValue ?? parseLegacyDayUI(s.day).value;
        const du = s.delayUnit ?? parseLegacyDayUI(s.day).unit;
        return {
          day: delayToLegacyDay(dv, du),
          text: String(s.text || "").trim(),
          delayValue: dv,
          delayUnit: du,
        };
      });
      const res = await axios.post("/api/drips/campaigns", {
        name: aiPreviewName.trim(),
        steps: normalized,
      });
      const created: ApiCampaign | undefined = res.data?.campaign;
      if (created?._id) setBackendCampaigns((prev) => [...prev, created]);
      setAIPreviewName("");
      setAIPreviewSteps([]);
      setAIDescription("");
      toast.success("✅ AI campaign saved!");
    } catch {
      toast.error("❌ Error saving campaign");
    } finally {
      setAIPreviewSaving(false);
    }
  };

  const discardAIPreview = () => {
    setAIPreviewName("");
    setAIPreviewSteps([]);
    setAIDescription("");
  };

  const [messageSteps, setMessageSteps] = useState<MessageStep[]>([
    { text: "", day: "immediately", delayValue: 0, delayUnit: "days" },
  ]);

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

  const handleNewStepChange = (
    idx: number,
    key: "text" | "delayValue" | "delayUnit",
    value: string | number,
  ) => {
    setMessageSteps((prev) => {
      const updated = [...prev];
      const step = { ...updated[idx] };
      if (key === "delayValue") {
        const num = typeof value === "number" ? value : parseInt(String(value), 10);
        step.delayValue = isNaN(num) ? 0 : Math.max(0, num);
        step.day = delayToLegacyDay(step.delayValue, step.delayUnit ?? "days");
      } else if (key === "delayUnit") {
        step.delayUnit = value as DripDelayUnit;
        step.day = delayToLegacyDay(step.delayValue ?? 0, step.delayUnit);
      } else {
        step.text = String(value);
      }
      updated[idx] = step;
      return updated;
    });
  };

  const handleAppendNewStep = () => {
    setMessageSteps((prev) => {
      const last = prev[prev.length - 1];
      const lastValue = last?.delayValue ?? 0;
      const lastUnit = last?.delayUnit ?? "days";
      const nextValue = lastValue + 1;
      const newStep: MessageStep = {
        text: "",
        day: delayToLegacyDay(nextValue, lastUnit),
        delayValue: nextValue,
        delayUnit: lastUnit,
      };
      return [...prev, newStep];
    });
  };

  const handleDuplicateNewStep = (idx: number) => {
    setMessageSteps((prev) => {
      const copy = { ...prev[idx] };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  };

  // Step 0 is always "Send immediately" and stays at position 0.
  // Move Up is only available for idx >= 2 (idx 1 cannot go above step 0).
  const handleMoveNewStepUp = (idx: number) => {
    if (idx < 2) return;
    setMessageSteps((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const handleMoveNewStepDown = (idx: number) => {
    setMessageSteps((prev) => {
      if (idx === 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  // ---- Save new custom campaign to backend ----
  const saveCampaign = async () => {
    const hasText = messageSteps.some((s) => s.text.trim());
    if (!campaignName.trim() || !hasText) {
      toast.error("❌ Please enter a campaign name and at least one message.");
      return;
    }

    try {
      const normalized = messageSteps.map((s) => {
        const dv = s.delayValue ?? 0;
        const du = s.delayUnit ?? "days";
        return {
          day: delayToLegacyDay(dv, du),
          text: String(s.text || "").trim(),
          delayValue: dv,
          delayUnit: du,
        };
      });

      const res = await axios.post("/api/drips/campaigns", {
        name: campaignName.trim(),
        steps: normalized,
      });

      const created: ApiCampaign | undefined = res.data?.campaign;
      if (created?._id) {
        setBackendCampaigns((prev) => [...prev, created]);
      }

      setCampaignName("");
      setMessageSteps([{ text: "", day: "immediately", delayValue: 0, delayUnit: "days" }]);

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
        const rawSteps = Array.isArray(foundPrebuilt.campaign?.steps) && foundPrebuilt.campaign?.steps?.length
          ? foundPrebuilt.campaign.steps
          : (foundPrebuilt.defaultSteps || []);
        const seeded = rawSteps.map((s: any) => normalizeStep(s));
        setEditableDrips((prev) => ({ ...prev, [dripId]: seeded }));
        return;
      }

      const foundBackend = backendCampaigns.find((c) => c._id === dripId);
      if (foundBackend) {
        const seeded = Array.isArray(foundBackend.steps)
          ? foundBackend.steps.map((s) => normalizeStep(s))
          : [];
        setEditableDrips((prev) => ({ ...prev, [dripId]: seeded }));
      }
    }
  };

  const handleEditMessage = (
    dripId: string,
    index: number,
    key: "text" | "day" | "delayValue" | "delayUnit",
    value: string | number,
  ) => {
    const updated = [...(editableDrips[dripId] || [])];
    if (!updated[index]) return;
    const step = { ...updated[index] };

    if (key === "delayValue") {
      const num = typeof value === "number" ? value : parseInt(String(value), 10);
      step.delayValue = isNaN(num) ? 0 : Math.max(0, num);
      const unit = step.delayUnit ?? "days";
      step.day = delayToLegacyDay(step.delayValue, unit);
    } else if (key === "delayUnit") {
      step.delayUnit = value as DripDelayUnit;
      step.day = delayToLegacyDay(step.delayValue ?? 0, step.delayUnit);
    } else if (key === "text") {
      step.text = String(value);
    } else {
      (step as any)[key] = value;
    }

    updated[index] = step;
    setEditableDrips({ ...editableDrips, [dripId]: updated });
  };

  const handleAppendEditableStep = (dripId: string) => {
    const existing = editableDrips[dripId] || [];
    const lastStep = existing[existing.length - 1];
    const lastValue = lastStep?.delayValue ?? 0;
    const lastUnit = lastStep?.delayUnit ?? "days";
    // Default next step: +1 of same unit, or 1 day if immediately
    const nextValue = lastUnit === "days" ? Math.max(1, lastValue + 1)
      : lastUnit === "months" ? lastValue + 1
      : lastUnit === "weeks" ? lastValue + 1
      : lastValue + 1;
    const newStep: MessageStep = {
      text: "",
      day: delayToLegacyDay(nextValue, lastUnit),
      delayValue: nextValue,
      delayUnit: lastUnit,
    };
    setEditableDrips((prev) => ({ ...prev, [dripId]: [...existing, newStep] }));
  };

  const handleRemoveNewStep = (index: number) => {
    if (index === 0) return; // step 0 cannot be deleted
    setMessageSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveEditableStep = (dripId: string, index: number) => {
    const updated = [...(editableDrips[dripId] || [])].filter((_, i) => i !== index);
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

    // Preserve edited text as written. First-touch opt-out is enforced at send time.
    const normalized = steps.map((s) => {
      const dv = s.delayValue ?? parseLegacyDayUI(s.day).value;
      const du = s.delayUnit ?? parseLegacyDayUI(s.day).unit;
      return {
        day: delayToLegacyDay(dv, du),
        text: String(s.text || "").trim(),
        delayValue: dv,
        delayUnit: du,
      };
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

    // Preserve edited text as written. First-touch opt-out is enforced at send time.
    const normalized = steps.map((s) => {
      const dv = s.delayValue ?? parseLegacyDayUI(s.day).value;
      const du = s.delayUnit ?? parseLegacyDayUI(s.day).unit;
      return {
        day: delayToLegacyDay(dv, du),
        text: String(s.text || "").trim(),
        delayValue: dv,
        delayUnit: du,
      };
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

    // Preserve edited text as written. First-touch opt-out is enforced at send time.
    const normalized = steps.map((s: any) => {
      const dv = s.delayValue ?? parseLegacyDayUI(s.day).value;
      const du = s.delayUnit ?? parseLegacyDayUI(s.day).unit;
      return {
        day: delayToLegacyDay(dv, du),
        text: String(s.text || "").trim(),
        delayValue: dv,
        delayUnit: du,
      };
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
      {/* SMS / Email tab toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setDripTab("sms")}
          className={`px-5 py-2 rounded-full text-sm font-medium transition ${
            dripTab === "sms"
              ? "bg-green-600 text-white"
              : "bg-[#1e293b] text-gray-400 border border-gray-600 hover:text-white"
          }`}
        >
          SMS
        </button>
        {isAdmin && (
          <button
            onClick={() => setDripTab("email")}
            className={`px-5 py-2 rounded-full text-sm font-medium transition ${
              dripTab === "email"
                ? "bg-blue-600 text-white"
                : "bg-[#1e293b] text-gray-400 border border-gray-600 hover:text-white"
            }`}
          >
            Email
          </button>
        )}
      </div>

      {/* Email tab — admin-only */}
      {dripTab === "email" && isAdmin && <EmailCampaignsPanel />}

      {/* SMS tab */}
      {dripTab === "sms" && <>

      {/* AI Builder toggle */}
      <div className="mb-4">
        <button
          onClick={() => setShowAIBuilder((v) => !v)}
          className="flex items-center gap-2 bg-indigo-700 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
        >
          🤖 Build with AI
        </button>
      </div>

      {showAIBuilder && (
        <div className="bg-[#0f172a] border border-indigo-600/30 rounded-xl p-5 space-y-4 mb-4">
          <h3 className="font-semibold text-white text-sm">AI Drip Builder</h3>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Describe your lead</label>
            <textarea
              value={aiScenario}
              onChange={(e) => setAIScenario(e.target.value)}
              rows={3}
              placeholder="e.g. 'Filled out a final expense form but didn't finish — likely price sensitive, 65+ year old, no current coverage'"
              className="w-full bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>
          <div className="flex gap-4 flex-wrap">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Type</label>
              <div className="flex gap-2">
                {(["sms", "email"] as const).map((t) => (
                  <button key={t} onClick={() => setAIType(t)}
                    className={`px-3 py-1 rounded text-xs font-semibold ${aiType === t ? "bg-indigo-600 text-white" : "bg-[#1e293b] text-gray-400 border border-white/10"}`}>
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Steps</label>
              <div className="flex gap-1">
                {[3, 5, 7, 10].map((n) => (
                  <button key={n} onClick={() => setAIStepCount(n)}
                    className={`px-3 py-1 rounded text-xs font-semibold ${aiStepCount === n ? "bg-indigo-600 text-white" : "bg-[#1e293b] text-gray-400 border border-white/10"}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={buildWithAI} disabled={aiBuilding || !aiScenario.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold text-white">
              {aiBuilding ? "Building your campaign..." : "Build Campaign"}
            </button>
            <button onClick={() => setShowAIBuilder(false)} className="text-gray-400 hover:text-white text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* AI Generated Campaign Preview */}
      {aiPreviewSteps.length > 0 && (
        <div className="bg-[#0f172a] border border-indigo-500/40 rounded-xl p-5 space-y-4 mb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold text-sm">🤖 AI Generated Campaign — Review &amp; Edit</h3>
            <button
              onClick={discardAIPreview}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Discard
            </button>
          </div>

          {aiDescription && (
            <div className="bg-blue-950/40 border border-blue-600/30 rounded-lg p-3 text-xs text-blue-200">
              {aiDescription}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Campaign Name</label>
            <input
              value={aiPreviewName}
              onChange={(e) => setAIPreviewName(e.target.value)}
              className="w-full bg-[#1e293b] border border-white/10 text-white rounded-lg px-3 py-2 text-sm"
              placeholder="Campaign name"
            />
          </div>

          <div className="space-y-3">
            {aiPreviewSteps.map((step, idx) => {
              const dv = step.delayValue ?? parseLegacyDayUI(step.day).value;
              const du = step.delayUnit ?? parseLegacyDayUI(step.day).unit;
              return (
                <div key={idx} className="bg-[#1e293b] border border-white/10 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400 font-medium">Message {idx + 1}</span>
                    {idx === 0 ? (
                      <span className="text-xs text-gray-600">Cannot remove first message</span>
                    ) : (
                      <button
                        onClick={() => setAIPreviewSteps((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {idx === 0 ? (
                    <p className="text-xs text-gray-400">Sends immediately when a lead is enrolled.</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">Wait</span>
                      <input
                        type="number"
                        min={1}
                        value={dv}
                        onChange={(e) => {
                          const num = parseInt(e.target.value, 10) || 1;
                          setAIPreviewSteps((prev) => prev.map((s, i) =>
                            i === idx ? { ...s, delayValue: num, delayUnit: du, day: delayToLegacyDay(num, du) } : s
                          ));
                        }}
                        className="w-20 bg-[#0b1220] border border-white/10 text-white rounded px-2 py-1 text-sm"
                      />
                      <select
                        value={du}
                        onChange={(e) => {
                          const unit = e.target.value as DripDelayUnit;
                          setAIPreviewSteps((prev) => prev.map((s, i) =>
                            i === idx ? { ...s, delayUnit: unit, day: delayToLegacyDay(dv, unit) } : s
                          ));
                        }}
                        className="bg-[#0b1220] border border-white/10 text-white rounded px-2 py-1 text-sm"
                      >
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                        <option value="months">Months</option>
                      </select>
                      <span className="text-xs text-gray-500">after enrollment</span>
                    </div>
                  )}
                  <textarea
                    value={step.text}
                    onChange={(e) => setAIPreviewSteps((prev) => prev.map((s, i) => i === idx ? { ...s, text: e.target.value } : s))}
                    rows={3}
                    className="w-full bg-[#0b1220] border border-white/10 text-white rounded-lg px-3 py-2 text-sm resize-none"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex gap-3">
            <button
              onClick={saveAIPreview}
              disabled={aiPreviewSaving}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 py-2 rounded-lg text-sm font-semibold text-white"
            >
              {aiPreviewSaving ? "Saving..." : "Save Campaign"}
            </button>
            <button
              onClick={discardAIPreview}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white border border-white/10"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Creator */}
      <div className="border border-white/10 bg-[#0f172a] p-5 rounded-xl space-y-4">
        <div>
          <h2 className="text-xl font-bold">Create Custom Drip Campaign</h2>
          <p className="text-xs text-gray-500 mt-1">
            Changes apply to new leads going forward. Leads already in this drip keep their current schedule.
          </p>
        </div>

        <input
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          placeholder="Campaign Name"
          className="bg-[#1e293b] border border-white/10 text-white px-3 py-2 w-full rounded-lg text-sm"
        />

        <div className="space-y-3">
          {messageSteps.map((step, idx) => (
            <div key={idx} className="bg-[#1e293b] border border-white/10 rounded-lg p-3 space-y-2">
              {/* Header row */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-medium text-white">Message {idx + 1}</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => handleMoveNewStepUp(idx)}
                    disabled={idx < 2}
                    className={`text-xs px-2 py-0.5 rounded ${idx < 2 ? "text-gray-600 cursor-not-allowed" : "text-gray-400 hover:text-white hover:bg-white/10"}`}
                    title={idx < 2 ? "Cannot move above Message 1" : "Move up"}
                  >
                    ↑ Up
                  </button>
                  <button
                    onClick={() => handleMoveNewStepDown(idx)}
                    disabled={idx === 0 || idx >= messageSteps.length - 1}
                    className={`text-xs px-2 py-0.5 rounded ${idx === 0 || idx >= messageSteps.length - 1 ? "text-gray-600 cursor-not-allowed" : "text-gray-400 hover:text-white hover:bg-white/10"}`}
                    title="Move down"
                  >
                    ↓ Down
                  </button>
                  <button
                    onClick={() => handleDuplicateNewStep(idx)}
                    className="text-xs px-2 py-0.5 rounded text-blue-400 hover:text-blue-300 hover:bg-white/10"
                  >
                    Duplicate
                  </button>
                  {idx === 0 ? (
                    <span className="text-xs text-gray-600 cursor-not-allowed" title="First message cannot be deleted">
                      Delete disabled
                    </span>
                  ) : (
                    <button
                      onClick={() => handleRemoveNewStep(idx)}
                      className="text-xs px-2 py-0.5 rounded text-red-400 hover:text-red-300 hover:bg-white/10"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Timing */}
              {idx === 0 ? (
                <p className="text-xs text-gray-400">Sends immediately when a lead is enrolled.</p>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400">Wait</span>
                  <input
                    type="number"
                    min={1}
                    value={step.delayValue ?? 1}
                    onChange={(e) => handleNewStepChange(idx, "delayValue", parseInt(e.target.value, 10) || 1)}
                    className="w-20 bg-[#0b1220] border border-white/10 text-white rounded px-2 py-1 text-sm"
                  />
                  <select
                    value={step.delayUnit ?? "days"}
                    onChange={(e) => handleNewStepChange(idx, "delayUnit", e.target.value)}
                    className="bg-[#0b1220] border border-white/10 text-white rounded px-2 py-1 text-sm"
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                  </select>
                  <span className="text-xs text-gray-500">after enrollment</span>
                </div>
              )}

              {/* Message body */}
              <textarea
                value={step.text}
                onChange={(e) => handleNewStepChange(idx, "text", e.target.value)}
                rows={3}
                placeholder={idx === 0 ? "First message text..." : "Message text..."}
                className="w-full bg-[#0b1220] border border-white/10 text-white rounded-lg px-3 py-2 text-sm resize-none"
              />
              <p className="text-xs text-gray-600">
                Tokens: {`{{ contact.first_name }}`}  {`{{ agent.name }}`}
              </p>
            </div>
          ))}
        </div>

        <button
          onClick={handleAppendNewStep}
          className="w-full border border-dashed border-white/20 text-gray-400 hover:text-white hover:border-white/40 rounded-lg py-2 text-sm transition"
        >
          + Add Message
        </button>

        <button
          onClick={saveCampaign}
          className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition"
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
                <p className="text-xs text-yellow-400 bg-yellow-900/30 border border-yellow-600/30 rounded px-3 py-2">
                  ⚠️ Delay changes apply to new enrollments only. Existing active leads keep their already-scheduled messages.
                </p>
                {editableDrips[String(campaignId)]?.map((msg, idx) => {
                  const isBday = isBirthdayStep(msg.day);
                  return (
                    <div key={idx} className="border border-white/10 rounded-lg p-3 space-y-2 bg-[#1e293b]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400 font-medium">Step {idx + 1} — {stepDelayLabel(msg)}</span>
                        {isBday ? (
                          <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Birthday (disabled)</span>
                        ) : (
                          <span className="text-xs text-gray-600 cursor-not-allowed" title="Step deletion is disabled. Active enrollments have already-scheduled messages for this step.">
                            Delete disabled
                          </span>
                        )}
                      </div>
                      {!isBday && (
                        <>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              value={msg.delayValue ?? parseLegacyDayUI(msg.day).value}
                              onChange={(e) => handleEditMessage(String(campaignId), idx, "delayValue", parseInt(e.target.value, 10) || 0)}
                              className="w-20 bg-[#0b1220] border border-white/10 text-white rounded px-2 py-1 text-sm"
                            />
                            <select
                              value={msg.delayUnit ?? parseLegacyDayUI(msg.day).unit}
                              onChange={(e) => handleEditMessage(String(campaignId), idx, "delayUnit", e.target.value)}
                              className="bg-[#0b1220] border border-white/10 text-white rounded px-2 py-1 text-sm"
                            >
                              <option value="hours">hours from enrollment</option>
                              <option value="days">days from enrollment</option>
                              <option value="weeks">weeks from enrollment</option>
                              <option value="months">months from enrollment</option>
                            </select>
                          </div>
                          <textarea
                            value={msg.text}
                            onChange={(e) => handleEditMessage(String(campaignId), idx, "text", e.target.value)}
                            rows={3}
                            className="w-full bg-[#0b1220] border border-white/10 text-white rounded-lg px-3 py-2 text-sm resize-none"
                          />
                        </>
                      )}
                      {isBday && <p className="text-xs text-gray-500">Birthday steps are currently disabled and will not be scheduled.</p>}
                    </div>
                  );
                })}

                <button
                  onClick={() => handleAppendEditableStep(String(campaignId))}
                  className="w-full border border-dashed border-white/20 text-gray-400 hover:text-white hover:border-white/40 rounded-lg py-2 text-sm"
                >
                  + Append Step
                </button>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => handleSaveCustomDrip(String(campaignId))}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded cursor-pointer text-sm"
                  >
                    Save Changes
                  </button>
                  <span className="text-xs text-gray-500">Reorder and insert-between are disabled.</span>
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
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAIBuilder(true); setAIType("sms"); }}
                className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-800 px-3 py-1 rounded"
              >
                🤖 Build with AI
              </button>
              <button
                onClick={() => handleAssignDrip(camp._id)}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm cursor-pointer"
              >
                Assign to Folder/Leads
              </button>
            </div>
          </div>

          {expandedDrips[camp._id] && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-yellow-400 bg-yellow-900/30 border border-yellow-600/30 rounded px-3 py-2">
                ⚠️ Delay changes apply to new enrollments only. Existing active leads keep their already-scheduled messages.
              </p>
              {editableDrips[camp._id]?.map((msg, idx) => {
                const isBday = isBirthdayStep(msg.day);
                return (
                  <div key={idx} className="border border-white/10 rounded-lg p-3 space-y-2 bg-[#1e293b]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400 font-medium">Step {idx + 1} — {stepDelayLabel(msg)}</span>
                      {isBday ? (
                        <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Birthday (disabled)</span>
                      ) : (
                        <span className="text-xs text-gray-600 cursor-not-allowed" title="Step deletion is disabled. Active enrollments have already-scheduled messages for this step.">
                          Delete disabled
                        </span>
                      )}
                    </div>
                    {!isBday && (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            value={msg.delayValue ?? parseLegacyDayUI(msg.day).value}
                            onChange={(e) => handleEditMessage(camp._id, idx, "delayValue", parseInt(e.target.value, 10) || 0)}
                            className="w-20 bg-[#0b1220] border border-white/10 text-white rounded px-2 py-1 text-sm"
                          />
                          <select
                            value={msg.delayUnit ?? parseLegacyDayUI(msg.day).unit}
                            onChange={(e) => handleEditMessage(camp._id, idx, "delayUnit", e.target.value)}
                            className="bg-[#0b1220] border border-white/10 text-white rounded px-2 py-1 text-sm"
                          >
                            <option value="hours">hours from enrollment</option>
                            <option value="days">days from enrollment</option>
                            <option value="weeks">weeks from enrollment</option>
                            <option value="months">months from enrollment</option>
                          </select>
                        </div>
                        <textarea
                          value={msg.text}
                          onChange={(e) => handleEditMessage(camp._id, idx, "text", e.target.value)}
                          rows={3}
                          className="w-full bg-[#0b1220] border border-white/10 text-white rounded-lg px-3 py-2 text-sm resize-none"
                        />
                      </>
                    )}
                    {isBday && <p className="text-xs text-gray-500">Birthday steps are currently disabled and will not be scheduled.</p>}
                  </div>
                );
              })}

              <button
                onClick={() => handleAppendEditableStep(camp._id)}
                className="w-full border border-dashed border-white/20 text-gray-400 hover:text-white hover:border-white/40 rounded-lg py-2 text-sm"
              >
                + Append Step
              </button>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => handleSaveCustomDrip(camp._id)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded cursor-pointer text-sm"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => handleDeleteCustomDrip(camp._id)}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded cursor-pointer text-sm"
                >
                  Delete Drip
                </button>
                <span className="text-xs text-gray-500">Reorder and insert-between are disabled.</span>
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
      </>}
    </div>
  );
}
