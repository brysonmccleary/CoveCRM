import React from "react";

const tabs = [
  "Home",
  "Leads",
  "Power Dialer",
  "Drip Campaigns",
  "Sequences",
  "Conversations",
  "Phone Numbers",
  "Team Activity",
  "Settings",
];

export default function DashboardLayout({ children, activeTab, setActiveTab }) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-60 bg-gray-800 text-white flex-shrink-0">
        <h2 className="text-2xl font-bold p-4 border-b border-gray-700">CoveCRM</h2>
        <nav className="flex flex-col">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-left px-4 py-2 border-b border-gray-700 hover:bg-gray-700 ${
                activeTab === tab ? "bg-gray-700 font-bold" : ""
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-gray-100 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}

