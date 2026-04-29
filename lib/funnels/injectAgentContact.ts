export type AgentContact = {
  name: string;
  phone: string;
  email?: string;
};

export function injectAgentContact(user: any, fallback?: Partial<AgentContact>): AgentContact {
  const numbers = Array.isArray(user?.numbers) ? user.numbers : [];
  const primaryNumber = numbers.find((n: any) => n?.phoneNumber)?.phoneNumber || "";
  const firstLast = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();

  return {
    name: String(fallback?.name || user?.name || firstLast || "").trim(),
    phone: String(fallback?.phone || user?.agentPhone || primaryNumber || "").trim(),
    email: String(fallback?.email || user?.email || "").trim() || undefined,
  };
}
