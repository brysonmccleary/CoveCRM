export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const links = [
    { name: "Home", path: "/dashboard?tab=home" },
    { name: "Leads", path: "/dashboard?tab=leads" },
    { name: "Workflows", path: "/dashboard?tab=workflows" },
    { name: "Drip Campaigns", path: "/drip-campaigns" },
    { name: "Conversations", path: "/dashboard?tab=conversations" },
    { name: "Team Activity", path: "/dashboard?tab=team-activity" },
    { name: "Numbers", path: "/dashboard?tab=numbers" },
    { name: "Settings", path: "/dashboard?tab=settings" },
  ];

  return (
    <div className="flex">
      <div className="bg-[#0f172a] text-white w-60 p-4 min-h-screen">
        <h1 className="text-xl font-bold mb-6">CoveCRM</h1>
        <nav className="space-y-2">
          {links.map((link) => (
            <a key={link.name} href={link.path} className="block hover:underline">
              {link.name}
            </a>
          ))}
        </nav>
        <div className="mt-8">
          <a href="/api/logout" className="block text-red-500 hover:underline">Log Out</a>
        </div>
      </div>
      <main className="flex-1 bg-[#0f172a] text-white p-6">
        <div className="bg-[#1e293b] rounded-xl p-6 shadow">
          {children}
        </div>
      </main>
    </div>
  );
}
