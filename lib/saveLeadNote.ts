// /lib/saveLeadNote.ts
export async function saveLeadNote(leadId: string, text: string) {
  const res = await fetch("/api/leads/add-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId, text }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.message || "Failed to save note");
  }
  return res.json();
}
