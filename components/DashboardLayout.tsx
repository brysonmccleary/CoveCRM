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
    <div className="min-h-screen flex bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-gray-800 shadow flex-shrink-0 p-4">
        <div className="flex items-center space-x-2 mb-6">
          <img src="/wave-logo.png" alt="Logo" className="h-10 w-10" />
          <span className="text-xl font-bold">CoveCRM</span>
        </div>
        <nav className="flex flex-col space-y-4">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-left hover:underline ${
                activeTab === tab ? "font-bold text-blue-600" : ""
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-6">
          <Link href="/auth/signout">Sign Out</Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

