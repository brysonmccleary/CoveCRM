// /components/dial/DialLeadCard.tsx
type Props = {
  lead: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    state?: string;
    age?: number;
    coverageAmount?: number;
    notes?: string;
  };
};

export default function DialLeadCard({ lead }: Props) {
  const f = (s?: string) => (s ? s : "—");
  const money = (n?: number) =>
    typeof n === "number" && !Number.isNaN(n) ? `$${n.toLocaleString()}` : "—";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border rounded p-4 bg-white">
      <div>
        <div className="text-xs text-gray-500">First Name</div>
        <div className="font-medium">{f(lead.firstName)}</div>
      </div>
      <div>
        <div className="text-xs text-gray-500">Last Name</div>
        <div className="font-medium">{f(lead.lastName)}</div>
      </div>
      <div>
        <div className="text-xs text-gray-500">Phone</div>
        <div className="font-medium">{f(lead.phone)}</div>
      </div>
      <div>
        <div className="text-xs text-gray-500">Email</div>
        <div className="font-medium break-all">{f(lead.email)}</div>
      </div>
      <div>
        <div className="text-xs text-gray-500">State</div>
        <div className="font-medium">{f(lead.state)}</div>
      </div>
      <div>
        <div className="text-xs text-gray-500">Age</div>
        <div className="font-medium">{lead.age ?? "—"}</div>
      </div>
      <div className="md:col-span-2">
        <div className="text-xs text-gray-500">Coverage Amount</div>
        <div className="font-medium">{money(lead.coverageAmount)}</div>
      </div>
      <div className="md:col-span-2">
        <div className="text-xs text-gray-500">Notes</div>
        <div className="font-medium whitespace-pre-wrap">
          {(lead.notes || "").trim() ? lead.notes : "—"}
        </div>
      </div>
    </div>
  );
}
