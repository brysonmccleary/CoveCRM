// pages/dashboard.tsx
import { GetServerSideProps } from "next";
import { getSession } from "next-auth/react";
import clientPromise from "../lib/mongodb";

interface Lead {
  _id: string;
  name: string;
  email: string;
  phone?: string;
}

interface DashboardProps {
  leads: Lead[];
}

export default function Dashboard({ leads }: DashboardProps) {
  return (
    <div className="min-h-screen flex bg-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-white shadow flex flex-col">
        <div className="p-6 flex items-center space-x-2">
          <img src="/logo.png" alt="CoveCRM" className="h-10 w-10" />
          <span className="text-2xl font-bold text-primary">CoveCRM</span>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <a href="/dashboard" className="block px-4 py-2 rounded hover:bg-gray-50 text-gray-800">Leads</a>
          <a href="/power-dialer" className="block px-4 py-2 rounded hover:bg-gray-50 text-gray-800">Power Dialer</a>
          <a href="/settings" className="block px-4 py-2 rounded hover:bg-gray-50 text-gray-800">Settings</a>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8">
        <h1 className="text-4xl font-semibold mb-6 text-gray-900">Dashboard</h1>

        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded shadow flex flex-col">
            <span className="text-sm text-gray-600">Total Calls</span>
            <span className="text-4xl font-bold text-primary">{leads.length * 5}</span>
          </div>
          <div className="bg-white p-6 rounded shadow flex flex-col">
            <span className="text-sm text-gray-600">Answered Calls</span>
            <span className="text-4xl font-bold text-secondary">{leads.length * 3}</span>
          </div>
          <div className="bg-white p-6 rounded shadow flex flex-col">
            <span className="text-sm text-gray-600">Sales</span>
            <span className="text-4xl font-bold text-accent">{leads.length}</span>
          </div>
        </div>

        {/* Recent Leads Table */}
        <div className="bg-white p-6 rounded shadow">
          <h2 className="text-2xl font-semibold mb-4 text-gray-800">Recent Leads</h2>
          <table className="w-full table-auto">
            <thead>
              <tr className="bg-gray-100">
                {['Name','Email','Phone'].map(header => (
                  <th key={header} className="px-4 py-2 text-left text-gray-700">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => (
                <tr key={lead._id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">{lead.name}</td>
                  <td className="px-4 py-2">{lead.email}</td>
                  <td className="px-4 py-2">{lead.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* CTA or Additional Widgets */}
        <div className="mt-8">
          <button className="px-6 py-3 bg-primary text-white rounded shadow hover:bg-primary-dark transition">
            Add New Lead
          </button>
        </div>
      </main>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getSession(context);
  if (!session) {
    return { redirect: { destination: '/auth/signin', permanent: false } };
  }

  const db = await clientPromise;
  const rawLeads = await db.db().collection('leads').find({ userEmail: session.user?.email }).toArray();
  const leads = rawLeads.map(l => ({
    _id: l._id.toString(),
    name: l.name,
    email: l.email,
    phone: l.phone || '',
  }));

  return { props: { leads } };
};

