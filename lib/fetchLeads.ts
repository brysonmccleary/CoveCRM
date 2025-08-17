// /lib/fetchLeads.ts
export interface Lead {
  id: string;
  [key: string]: any;
}

export async function fetchLeads(): Promise<Lead[]> {
  try {
    const res = await fetch("/api/get-leads");
    if (!res.ok) {
      console.error("Lead list fetch failed:", await res.text());
      return [];
    }

    const data = await res.json();
    return data.leads || [];
  } catch (error) {
    console.error("Lead list fetch error:", error);
    return [];
  }
}
