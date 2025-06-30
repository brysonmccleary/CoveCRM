export const saveMappingToLocal = (name: string, mappings: any[]) => {
  const savedMappings = JSON.parse(localStorage.getItem("lead_mappings") || "[]");
  savedMappings.push({ name, fields: mappings });
  localStorage.setItem("lead_mappings", JSON.stringify(savedMappings));
};

export const getSavedMappings = (): { name: string; fields: any[] }[] => {
  return JSON.parse(localStorage.getItem("lead_mappings") || "[]");
};

