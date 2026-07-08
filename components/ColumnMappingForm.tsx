import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";
import {
  buildAutoMapping,
  CANONICAL_FIELDS,
  customFieldTarget,
  DONT_IMPORT,
  isCanonicalField,
  parseCustomFieldTarget,
  type ImportTarget,
} from "@/lib/leads/importFieldRegistry";

export type MappingSubmitPayload = {
  mapping: Record<string, string>;
  targetFolderId?: string;
  folderName?: string;
  skipExisting: boolean;
};

type Folder = { _id: string; name: string };

const LOCAL_KEY_MAPPING = "leadImport:mapping:v1";
const LOCAL_KEY_FOLDER = "leadImport:lastFolderId";
const LOCAL_KEY_SKIP = "leadImport:skipExisting";

export default function ColumnMappingForm({
  headers,
  sampleRow,
  onSubmit,
  onBack,
}: {
  headers: string[];
  sampleRow?: Record<string, any>;
  onSubmit: (payload: MappingSubmitPayload) => void;
  onBack?: () => void;
}) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [useExisting, setUseExisting] = useState(true);
  const [targetFolderId, setTargetFolderId] = useState("");
  const [folderName, setFolderName] = useState("");
  const [skipExisting, setSkipExisting] = useState(true);

  const [mapSel, setMapSel] = useState<Record<string, string>>({});

  // Load folders + prior prefs
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/get-folders");
        if (r.ok) {
          const data = await r.json();
          const list: Folder[] = Array.isArray(data?.folders) ? data.folders : data;
          // Hide system folders from the dropdown
          const visible = (list || []).filter((f) => !isSystemFolder(f.name));
          setFolders(visible);
        }
      } catch {
        /* no-op */
      }
      try {
        const savedMap = localStorage.getItem(LOCAL_KEY_MAPPING);
        if (savedMap) {
          const parsed = JSON.parse(savedMap);
          if (parsed && typeof parsed === "object") {
            setMapSel((prev) => ({ ...prev, ...parsed }));
          }
        }
        const lastFolder = localStorage.getItem(LOCAL_KEY_FOLDER);
        if (lastFolder) {
          setTargetFolderId(lastFolder);
          setUseExisting(true);
        }
        const savedSkip = localStorage.getItem(LOCAL_KEY_SKIP);
        if (savedSkip != null) setSkipExisting(savedSkip === "true");
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Set best-guess/custom defaults for every CSV column.
  useEffect(() => {
    setMapSel((prev) => {
      const auto = buildAutoMapping(headers);
      const next: Record<string, string> = {};
      for (const h of headers) {
        next[h] = prev[h] || String(auto[h] || customFieldTarget(h));
      }
      return next;
    });
  }, [headers]);

  const targetOptions = useMemo(
    () => [DONT_IMPORT, ...CANONICAL_FIELDS],
    []
  );
  const atLeastOneId = useMemo(
    () => Object.values(mapSel).some((target) => target === "Phone" || target === "Email"),
    [mapSel]
  );

  const updateTarget = (header: string, target: ImportTarget) => {
    setMapSel((prev) => ({
      ...prev,
      [header]: String(target),
    }));
  };

  const updateCustomName = (header: string, value: string) => {
    setMapSel((prev) => ({
      ...prev,
      [header]: customFieldTarget(value || header),
    }));
  };

  const submit = () => {
    if (useExisting && !targetFolderId) {
      toast.error("❌ Choose a folder to import into.");
      return;
    }
    if (!useExisting && !folderName.trim()) {
      toast.error("❌ Enter a new folder name.");
      return;
    }
    if (!atLeastOneId) {
      toast.error("❌ Map at least Phone or Email so we can de-dupe.");
      return;
    }

    // If user typed a system folder name, auto-suffix to a safe name
    let finalFolderName = folderName.trim();
    if (!useExisting && finalFolderName && isSystemFolder(finalFolderName)) {
      finalFolderName = `${finalFolderName} (Leads)`;
      toast("“System” folder name detected — using: " + finalFolderName, { icon: "🛡️" });
    }

    const normalizedMapping: Record<string, string> = {};
    for (const header of headers) {
      normalizedMapping[header] = mapSel[header] || customFieldTarget(header);
    }

    // persist prefs
    localStorage.setItem(LOCAL_KEY_MAPPING, JSON.stringify(mapSel));
    localStorage.setItem(LOCAL_KEY_SKIP, String(skipExisting));
    if (useExisting && targetFolderId) localStorage.setItem(LOCAL_KEY_FOLDER, targetFolderId);

    onSubmit({
      mapping: normalizedMapping,
      targetFolderId: useExisting ? targetFolderId : undefined,
      folderName: useExisting ? undefined : finalFolderName,
      skipExisting,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Map Columns & Choose Folder</h2>
        {onBack && (
          <button onClick={onBack} className="text-sm underline">
            ← Back
          </button>
        )}
      </div>

      {/* Folder selection */}
      <div className="space-y-2">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={useExisting}
              onChange={() => setUseExisting(true)}
            />
            <span>Import into existing folder</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={!useExisting}
              onChange={() => setUseExisting(false)}
            />
            <span>Create new folder</span>
          </label>
        </div>

        {useExisting ? (
          <div>
            <label className="block font-semibold mb-1">Add to Folder</label>
            <select
              value={targetFolderId}
              onChange={(e) => setTargetFolderId(e.target.value)}
              className="border p-2 rounded w-full"
            >
              <option value="">— Select a folder —</option>
              {folders.map((f) => (
                <option key={f._id} value={f._id}>
                  {f.name}
                </option>
              ))}
            </select>
            {folders.length === 0 && (
              <div className="text-xs text-gray-500 mt-1">
                (System folders are hidden here. Create a new folder name below if needed.)
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="block font-semibold mb-1">New Folder Name</label>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g., Mortgage Leads 7/1"
              className="border p-2 rounded w-full"
            />
          </div>
        )}
      </div>

      {/* Options */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={skipExisting}
          onChange={(e) => setSkipExisting(e.target.checked)}
        />
        <span>Skip existing leads (dedupe by phone/email)</span>
      </label>

      {/* Mapping */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {headers.map((header) => {
          const currentTarget = mapSel[header] || customFieldTarget(header);
          const isSystemMapped = isCanonicalField(currentTarget);
          const isSkipped = currentTarget === DONT_IMPORT;
          const customName = parseCustomFieldTarget(currentTarget, header);
          return (
            <div key={header} className="border border-black dark:border-white p-2 rounded">
              <div className="font-semibold mb-1">{header}</div>
              {isSystemMapped ? (
                <select
                  className="border p-2 rounded w-full"
                  value={currentTarget}
                  onChange={(e) => updateTarget(header, e.target.value)}
                >
                  {targetOptions.map((target) => (
                    <option key={target} value={target}>
                      {target}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isSkipped}
                      onChange={(e) =>
                        updateTarget(
                          header,
                          e.target.checked ? DONT_IMPORT : customFieldTarget(header)
                        )
                      }
                    />
                    <span>Don't import</span>
                  </label>
                  {!isSkipped && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Imports as:</div>
                      <input
                        className="border p-2 rounded w-full"
                        value={customName}
                        onChange={(e) => updateCustomName(header, e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
              {sampleRow && !isSkipped && (
                <div className="text-xs text-gray-500 mt-1">
                  Sample: <span className="font-mono">{String(sampleRow[header]) || "—"}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={submit}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
        >
          Save & Import
        </button>
      </div>
    </div>
  );
}
