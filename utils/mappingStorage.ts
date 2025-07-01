const LOCAL_STORAGE_KEY = "lead_mappings";

export const saveMappingToLocal = (name: string, fields: any[]) => {
  const existing = getSavedMappings();
  const newMappings = [...existing, { name, fields }];
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newMappings));
};

export const getSavedMappings = () => {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(LOCAL_STORAGE_KEY);
  return data ? JSON.parse(data) : [];
};

