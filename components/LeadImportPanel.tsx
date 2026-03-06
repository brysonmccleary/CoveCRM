// components/LeadImportPanel.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import toast from "react-hot-toast";
import { isSystemFolderName as isSystemFolder, isSystemish } from "@/lib/systemFolders";

type Folder = { _id: string; name: string };

const LOCAL_KEY_MAPPING = "leadImport:mapping:v1";
const LOCAL_KEY_FOLDER = "leadImport:lastFolderId";
const LOCAL_KEY_SKIP = "leadImport:skipExisting";

type SavedImportTemplate = {
  _id?: string;
  name: string;
  mapping: Record<string, string>;
  skipHeader: Record<string, boolean>;
  customFieldNames: Record<string, string>;
};

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

const systemFields = [
  ...CANONICAL_FIELDS,
  "Address",
  "City",
  "Zip",
  "DOB",
  "Age",
  "Coverage Amount",
  "Add Custom Field",
];

function lc(s?: string) {
  return (s || "").toLowerCase();
}

function bestGuessField(header: string): Canonical | "" {
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

const fieldKeyForApi: Record<Canonical, string> = {
  "First Name": "firstName",
  "Last Name": "lastName",
  Phone: "phone",
  Email: "email",
  State: "state",
  Notes: "notes",
  Source: "source",
};

export default function LeadImportPanel({ onImportSuccess }: { onImportSuccess?: () => void }) {
  // CSV
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<Record<string, any>[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  // Mapping state
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [skipHeader, setSkipHeader] = useState<Record<string, boolean>>({});
  const [customFieldNames, setCustomFieldNames] = useState<Record<string, string>>({});
  const [templateName, setTemplateName] = useState("");
  const [templates, setTemplates] = useState<SavedImportTemplate[]>([]);

  // Folders
  const [folders, setFolders] = useState<Folder[]>([]);
  const [useExisting, setUseExisting] = useState(true);
  const [targetFolderId, setTargetFolderId] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState("");

  // Options
  const [skipExisting, setSkipExisting] = useState<boolean>(true);

  // UI
  const [isUploading, setIsUploading] = useState(false);
  const [resultCounts, setResultCounts] = useState<{
    inserted?: number;
    updated?: number;
    skipped?: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load folders + local prefs
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/get-folders");
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data?.folders)) setFolders(data.folders);
          else if (Array.isArray(data)) setFolders(data as Folder[]);
        }
      } catch {
        /* no-op */
      }

      try {
        const saved = localStorage.getItem(LOCAL_KEY_MAPPING);
        if (saved) setMapping(JSON.parse(saved));

        // Purge *any* stale saved folder id on mount; we’ll only re-save when user picks one.
        localStorage.removeItem(LOCAL_KEY_FOLDER);

        const savedSkip = localStorage.getItem(LOCAL_KEY_SKIP);
        if (savedSkip != null) setSkipExisting(savedSkip === "true");
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/mappings");
        if (!r.ok) return;
        const data = await r.json();
        const next = Array.isArray(data)
          ? data.map((item: any) => ({
              _id: item?._id ? String(item._id) : undefined,
              name: String(item?.name || ""),
              mapping: { ...(item?.fields?.mapping || {}) },
              skipHeader: { ...(item?.fields?.skipHeader || {}) },
              customFieldNames: { ...(item?.fields?.customFieldNames || {}) },
            })).filter((item: SavedImportTemplate) => item.name)
          : [];
        setTemplates(next);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // If a previously-saved system folder id sneaks in, drop it (extra hardening)
  useEffect(() => {
    if (!folders.length) return;
    const safe = folders.filter((f) => !isSystemFolder(f.name) && !isSystemish(f.name));
    if (!safe.some((f) => f._id === targetFolderId)) {
      setTargetFolderId("");
    }
  }, [folders, targetFolderId]);

  // Auto-open file picker on mount
  useEffect(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      toast.error("❌ No file selected");
      return;
    }
    setUploadedFile(file);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const typedData = (results.data as Record<string, any>[]).filter(Boolean);
        const validHeaders = headers.filter((h) =>
          typedData.some((row) => row[h] && String(row[h]).trim() !== "")
        );

        const nextMap: Record<string, string> = { ...(mapping || {}) };
        validHeaders.forEach((h) => {
          if (!nextMap[h]) {
            const guess = bestGuessField(h);
            if (guess) nextMap[h] = guess;
          }
        });

        setCsvHeaders(validHeaders);
        setCsvData(typedData);
        setMapping(nextMap);
        setSkipHeader({});
        setCustomFieldNames({});
        setResultCounts(null);
      },
    });
  };

  const getAvailableFields = (currentHeader: string) => {
    const selected = Object.entries(mapping)
      .filter(([h]) => h !== currentHeader)
      .map(([, val]) => val)
      .filter((v) => v && v !== "Add Custom Field");
    return systemFields.filter((f) => !selected.includes(f) || f === mapping[currentHeader]);
  };

  const atLeastOneIdFieldChosen = useMemo(() => {
    const chosen = new Set(Object.values(mapping));
    return chosen.has("Phone") || chosen.has("Email");
  }, [mapping]);

  const buildApiMappingObject = () => {
    const result: Record<string, string> = {};
    for (const [header, fieldLabel] of Object.entries(mapping)) {
      if (!fieldLabel || skipHeader[header] || fieldLabel === "Add Custom Field") continue;
      if ((CANONICAL_FIELDS as readonly string[]).includes(fieldLabel)) {
        const apiKey = fieldKeyForApi[fieldLabel as Canonical];
        if (!result[apiKey]) result[apiKey] = header;
      }
    }
    return result;
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      toast.error("❌ Enter a template name");
      return;
    }

    const payload = {
      name,
      fields: {
        mapping: { ...(mapping || {}) },
        skipHeader: { ...(skipHeader || {}) },
        customFieldNames: { ...(customFieldNames || {}) },
      },
    };

    try {
      const r = await fetch("/api/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.message || "Failed to save template");
      }

      const saved: SavedImportTemplate = {
        _id: data?._id ? String(data._id) : undefined,
        name: String(data?.name || name),
        mapping: { ...(data?.fields?.mapping || payload.fields.mapping) },
        skipHeader: { ...(data?.fields?.skipHeader || payload.fields.skipHeader) },
        customFieldNames: {
          ...(data?.fields?.customFieldNames || payload.fields.customFieldNames),
        },
      };

      setTemplates((prev) => {
        const next = prev.filter(
          (t) => t.name.trim().toLowerCase() !== saved.name.trim().toLowerCase()
        );
        next.push(saved);
        next.sort((a, b) => a.name.localeCompare(b.name));
        return next;
      });

      toast.success(`✅ Saved template: ${saved.name}`);
      setTemplateName("");
    } catch (e: any) {
      toast.error(`❌ ${e?.message || "Failed to save template"}`);
    }
  };

  const applyTemplateByName = (name: string) => {
    if (!name) return;
    const tpl = templates.find((t) => t?.name === name);
    if (!tpl) {
      toast.error("❌ Template not found");
      return;
    }
    setMapping({ ...(tpl.mapping || {}) });
    setSkipHeader({ ...(tpl.skipHeader || {}) });
    setCustomFieldNames({ ...(tpl.customFieldNames || {}) });
    toast.success(`✅ Loaded template: ${name}`);
  };

  const handleImport = async () => {
    try {
      if (!uploadedFile) {
        toast.error("❌ No CSV file uploaded");
        return;
      }

      // Folder validation
      if (useExisting) {
        if (!targetFolderId) {
          toast.error("❌ Choose a folder to import into");
          return;
        }
        const selected = folders.find((f) => f._id === targetFolderId);
        if (selected && (isSystemFolder(selected.name) || isSystemish(selected.name))) {
          toast.error("Cannot import into system folders");
          return;
        }
      } else {
        const name = newFolderName.trim();
        if (!name) {
          // Auto mode: backend will require a folder; if left blank it’ll return a 400 with message.
        } else if (isSystemFolder(name) || isSystemish(name)) {
          toast.error("Cannot import into system folders");
          return;
        }
      }

      // Mapping validation
      if (!atLeastOneIdFieldChosen) {
        toast.error("❌ Map at least Phone or Email so we can de-dupe");
        return;
      }

      const mappingForApi = buildApiMappingObject();
      if (!Object.keys(mappingForApi).length) {
        toast.error("❌ No usable mappings selected");
        return;
      }

      // Persist preferences (but never persist folder id automatically)
      localStorage.setItem(LOCAL_KEY_MAPPING, JSON.stringify(mapping));
      localStorage.setItem(LOCAL_KEY_SKIP, String(skipExisting));
      if (useExisting && targetFolderId) {
        localStorage.setItem(LOCAL_KEY_FOLDER, targetFolderId);
      } else {
        localStorage.removeItem(LOCAL_KEY_FOLDER);
      }

      const form = new FormData();
      form.append("file", uploadedFile);
      form.append("mapping", JSON.stringify(mappingForApi));
      form.append(
        "skipHeaders",
        JSON.stringify(
          Object.keys(skipHeader).filter((header) => !!skipHeader[header])
        )
      );
      form.append("skipExisting", String(skipExisting));
      form.append("_ts", String(Date.now()));

      if (useExisting) {
        form.append("targetFolderId", targetFolderId);
      } else {
        const name = newFolderName.trim();
        if (name) {
          // Only pass names when user typed a non-empty custom name
          form.append("folderName", name);
          form.append("newFolderName", name);
          form.append("newFolder", name);
          form.append("name", name);
        }
      }

      setIsUploading(true);
      setResultCounts(null);

      const res = await fetch("/api/import-leads", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.message || data?.error || "Import failed");

      const inserted = data?.counts?.inserted ?? 0;
      const updated = data?.counts?.updated ?? 0;
      const skipped = data?.counts?.skipped ?? 0;

      if (data?.counts) {
        setResultCounts({ inserted, updated, skipped });
        toast.success(`✅ Import: ${inserted} new • ${updated} updated • ${skipped} skipped`);
      } else {
        toast.success(`✅ Imported ${data?.count ?? "leads"}`);
      }

      // Reset file & preview, keep mapping preference
      setUploadedFile(null);
      setCsvHeaders([]);
      setCsvData([]);
      setSkipHeader({});
      setCustomFieldNames({});

      onImportSuccess?.();
    } catch (e: any) {
      console.error("❌ Import error:", e);
      toast.error(`❌ ${e?.message || "An unexpected error occurred"}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="border border-black dark:border-white p-4 mt-4 rounded space-y-4">
      <h2 className="text-xl font-bold">Import Leads</h2>

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
              onChange={() => {
                setUseExisting(false);
                setTargetFolderId("");
                localStorage.removeItem(LOCAL_KEY_FOLDER);
              }}
            />
            <span>Create new folder / Auto</span>
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
              {folders
                .filter((f) => !isSystemFolder(f.name) && !isSystemish(f.name))
                .map((f) => (
                  <option key={f._id} value={f._id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="block font-semibold mb-1">
              New Folder Name (leave blank for Auto)
            </label>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="(blank = backend will require you to pick a folder)"
              className="border p-2 rounded w-full"
            />
          </div>
        )}
      </div>

      {/* Options */}
      <div className="flex items-center gap-3">
        <input
          id="skipExisting"
          type="checkbox"
          checked={skipExisting}
          onChange={(e) => setSkipExisting(e.target.checked)}
        />
        <label htmlFor="skipExisting" className="cursor-pointer">
          Skip existing leads (dedupe by phone/email)
        </label>
      </div>

      {/* File choose */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="bg-[#6b5b95] text-white px-4 py-2 rounded hover:opacity-90 disabled:opacity-60"
          disabled={isUploading}
        >
          Choose CSV File
        </button>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          ref={fileInputRef}
          className="hidden"
        />
        {uploadedFile && (
          <span className="text-sm text-gray-600">{uploadedFile.name}</span>
        )}
      </div>

      {/* Mapping UI */}
      {csvHeaders.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm text-gray-600">
            Map your CSV columns to fields. We’ll remember your choices.
          </div>

          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name"
              className="border p-2 rounded md:w-64"
            />

            <button
              type="button"
              onClick={saveTemplate}
              className="bg-black text-white dark:bg-white dark:text-black px-4 py-2 rounded hover:opacity-90"
              disabled={isUploading}
            >
              Save Template
            </button>

            <select
              defaultValue=""
              onChange={(e) => {
                applyTemplateByName(e.target.value);
                e.currentTarget.value = "";
              }}
              className="border p-2 rounded md:w-72"
              disabled={isUploading}
            >
              <option value="">Load Saved Template</option>
              {templates.map((tpl) => (
                <option key={tpl._id || tpl.name} value={tpl.name}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </div>

          {csvHeaders.map((header) => (
            <div
              key={header}
              className="flex flex-col md:flex-row md:items-center md:space-x-4 border border-black dark:border-white p-2 rounded"
            >
              <div className="font-semibold w-56">
                {header}
                <div className="text-gray-500 text-xs mt-1">
                  ({csvData[0]?.[header] ?? "No sample"})
                </div>
              </div>

              <select
                value={mapping[header] || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setMapping((prev) => ({ ...prev, [header]: val }));
                  if (val !== "Add Custom Field") {
                    setCustomFieldNames((prev) => ({ ...prev, [header]: "" }));
                  }
                }}
                className="border p-2 rounded flex-1"
                disabled={!!skipHeader[header]}
              >
                <option value="">Select Field</option>
                {systemFields.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>

              {mapping[header] === "Add Custom Field" && (
                <input
                  type="text"
                  value={customFieldNames[header] || ""}
                  onChange={(e) =>
                    setCustomFieldNames((prev) => ({
                      ...prev,
                      [header]: e.target.value,
                    }))
                  }
                  placeholder="Custom field name"
                  className="border p-2 rounded flex-1 mt-2 md:mt-0"
                />
              )}

              <label className="flex items-center gap-2 mt-2 md:mt-0">
                <input
                  type="checkbox"
                  checked={!!skipHeader[header]}
                  onChange={(e) =>
                    setSkipHeader((prev) => ({
                      ...prev,
                      [header]: e.target.checked,
                    }))
                  }
                />
                <span>Do Not Import</span>
              </label>
            </div>
          ))}

          <div className="pt-2">
            <button
              onClick={handleImport}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded disabled:opacity-60"
              disabled={isUploading}
            >
              {isUploading ? "Importing..." : "Save & Import"}
            </button>
          </div>

          {resultCounts && (
            <div className="text-sm text-gray-700 mt-2">
              Inserted: <b>{resultCounts.inserted ?? 0}</b> • Updated:{" "}
              <b>{resultCounts.updated ?? 0}</b> • Skipped:{" "}
              <b>{resultCounts.skipped ?? 0}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
