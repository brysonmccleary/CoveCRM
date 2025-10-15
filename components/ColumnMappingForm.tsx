import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

export type MappingSubmitPayload = {
  mapping: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    state?: string;
    notes?: string;
    source?: string;
  };
  targetFolderId?: string;
  folderName?: string;
  skipExisting: boolean;
};

type Folder = { _id: string; name: string };

const LOCAL_KEY_MAPPING = "leadImport:mapping:v1";
const LOCAL_KEY_FOLDER = "leadImport:lastFolderId";
const LOCAL_KEY_SKIP = "leadImport:skipExisting";

const CANONICAL_FIELDS = [
  "First Name",
  "Last Name",
  "Phone",
  "Email",
  "State",
  "Notes",
  "Source",
] as const;

type Canonical = (typeof CANONICAL_FIELDS)[number];

const apiKey: Record<Canonical, keyof MappingSubmitPayload["mapping"]> = {
  "First Name": "firstName",
  "Last Name": "lastName",
  Phone: "phone",
  Email: "email",
  State: "state",
  Notes: "notes",
  Source: "source",
};

function lc(s?: string) {
  return (s || "").toLowerCase();
}

function bestGuess(header: string): Canonical | "" {
  const h = lc(header).replace(/\s|_|-/g, "");
  if (/^first$|^firstname$|^fname$|^givenname$/.test(h)) return "First Name";
  if (/^last$|^lastname$|^lname$|^surname$|^familyname$/.test(h)) return "Last Name";
  if (/^phone$|^mobile$|^cell$|^telephone$|^tel$|^phonenumber$/.test(h)) return "Phone";
  if (/^email$|^e?mailaddress$|^emailid$/.test(h)) return "Email";
  if (/^state$|^st$|^region$/.test(h)) return "State";
  if (/^notes?$|^comments?$|^memo$/.test(h)) return "Notes";
  if (/^source$|^leadsource$|^utm(source)?$/.test(h)) return "Source";
  return "";
}

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

  // canonicalKey -> selected CSV header
  const [mapSel, setMapSel] = useState<Record<keyof MappingSubmitPayload["mapping"], string>>({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    state: "",
    notes: "",
    source: "",
  });

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
        if (savedMap) setMapSel(JSON.parse(savedMap));
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

  // Set best-guess defaults for any unmapped fields
  useEffect(() => {
    setMapSel((prev) => {
      const next = { ...prev };
      const chosen = new Set(Object.values(prev).filter(Boolean));
      for (const h of headers) {
        const guess = bestGuess(h);
        if (guess) {
          const key = apiKey[guess];
          if (!next[key] && !chosen.has(h)) next[key] = h;
        }
      }
      return next;
    });
  }, [headers]);

  const options = useMemo(() => ["", ...headers], [headers]);
  const atLeastOneId = useMemo(
    () => Boolean(mapSel.phone || mapSel.email),
    [mapSel.phone, mapSel.email]
  );

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

    // persist prefs
    localStorage.setItem(LOCAL_KEY_MAPPING, JSON.stringify(mapSel));
    localStorage.setItem(LOCAL_KEY_SKIP, String(skipExisting));
    if (useExisting && targetFolderId) localStorage.setItem(LOCAL_KEY_FOLDER, targetFolderId);

    onSubmit({
      mapping: mapSel,
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
        {CANONICAL_FIELDS.map((label) => {
          const key = apiKey[label];
          return (
            <div key={label} className="border border-black dark:border-white p-2 rounded">
              <div className="font-semibold mb-1">{label}</div>
              <select
                className="border p-2 rounded w-full"
                value={mapSel[key] || ""}
                onChange={(e) =>
                  setMapSel((prev) => ({ ...prev, [key]: e.target.value }))
                }
              >
                {options.map((h) => (
                  <option key={h} value={h}>
                    {h || "— Not Mapped —"}
                  </option>
                ))}
              </select>
              {mapSel[key] && sampleRow && (
                <div className="text-xs text-gray-500 mt-1">
                  Sample: <span className="font-mono">{String(sampleRow[mapSel[key]]) || "—"}</span>
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
