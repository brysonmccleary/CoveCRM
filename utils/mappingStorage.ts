export function saveMappingToLocal(name: string, fields: any) {
  let mappings = JSON.parse(localStorage.getItem("mappings") || "[]");
  mappings.push({ name, fields });
  localStorage.setItem("mappings", JSON.stringify(mappings));
}

export function getSavedMappings() {
  if (typeof window === "undefined") return [];
  return JSON.parse(localStorage.getItem("mappings") || "[]");
}

