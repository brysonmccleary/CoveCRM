const sidebarItems = [
  { category: "Account", links: ["Profile", "Appearance", "Memberships"] },
  { category: "Organization", links: ["General", "Team Management", "Roles & Permissions"] },
  { category: "Customization", links: ["Custom Activities", "Custom Fields", "Shared Fields"] },
  { category: "Communication", links: ["Phone & Voicemail", "Dialer", "Email", "Booking"] },
  { category: "Connect", links: ["Integrations", "Developer"] },
  { category: "Billing", links: ["Plan", "Payment", "Usage"] },
];

export default function SettingsSidebar({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (s: string) => void;
}) {
  return (
    <div className="w-64 h-full p-4 overflow-y-auto bg-[#0f172a] border-r border-[#1e293b] text-white">
      {sidebarItems.map(({ category, links }) => (
        <div key={category} className="mb-6">
          <h4 className="text-sm font-bold uppercase text-gray-400 mb-2">{category}</h4>
          {links.map((link) => (
            <button
              key={link}
              onClick={() => onSelect(link)}
              className={`block text-left w-full px-3 py-2 rounded text-sm transition ${
                selected === link
                  ? "bg-blue-600 text-white"
                  : "hover:bg-gray-700 text-gray-300"
              }`}
            >
              {link}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
