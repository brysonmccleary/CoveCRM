// /lib/fetchLeadById.ts
export interface Lead {
  id: string;
  [key: string]: any;
}

export async function fetchLeadById(id: string): Promise<Lead | null> {
  try {
    const res = await fetch(`/api/get-lead?id=${id}`);
    if (!res.ok) {
      console.error("Lead fetch failed:", await res.text());
      return null;
    }

    const data = await res.json();
    return data.lead || null;
  } catch (error) {
    console.error("Lead fetch error:", error);
    return null;
  }
}
