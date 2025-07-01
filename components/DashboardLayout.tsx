import React from "react";
import Link from "next/link";

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

export default function DashboardLayout({
  children,
  activeTab,
  setActiveTab,
}: {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex space-x-4 p-4 bg-gray-100 border-b">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 rounded ${
              activeTab === tab ? "bg-blue-500 text-white" : "bg-white text-black"
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>
      <main className="flex-grow p-4">{children}</main>
    </div>
  );
}

