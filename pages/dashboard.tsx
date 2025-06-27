import { GetServerSideProps, GetServerSidePropsContext } from "next";
import { getSession } from "next-auth/react";
import clientPromise from "../lib/mongodb";
import { useState, useEffect, FormEvent } from "react";
import axios from "axios";

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface DashboardProps {
  initialLeads: Lead[];
}

export default function Dashboard({ initialLeads }: DashboardProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });

  useEffect(() => {
    axios.get<Lead[]>("/api/leads").then(res => setLeads(res.data));
  }, []);

  const addLead = async (e: FormEvent) => {
    e.preventDefault();
    const res = await axios.post<Lead>("/api/leads/create", form);
    setLeads(prev => [...prev, res.data]);
    setForm({ name: "", email: "", phone: "" });
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-3xl mb-6">Your Leads</h1>

      <form onSubmit={addLead} className="mb-8 grid grid-cols-1 sm:grid-cols-4 gap-4">
        <input
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Name"
          className="border p-2 rounded"
          required
        />
        <input
          type="email"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          placeholder="Email"
          className="border p-2 rounded"
          required
        />
        <input
          value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          placeholder="Phone"
          className="border p-2 rounded"
        />
        <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded">
          Add Lead
        </button>
      </form>

      <table className="w-full table-auto border-collapse">
        <thead>
          <tr className="bg-gray-100">
            <th className="border px-4 py-2 text-left">Name</th>
            <th className="border px-4 py-2 text-left">Email</th>
            <th className="border px-4 py-2 text-left">Phone</th>
          </tr>
        </thead>
        <tbody>
          {leads.map(l => (
            <tr key={l.id}>
              <td className="border px-4 py-2">{l.name}</td>
              <td className="border px-4 py-2">{l.email}</td>
              <td className="border px-4 py-2">{l.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<DashboardProps> =
  async (context: GetServerSidePropsContext) => {
    const session = await getSession(context);
    if (!session) {
      return { redirect: { destination: "/auth/signin", permanent: false } };
    }
    const db = await clientPromise;
    const raw = await db
      .db()
      .collection("leads")
      .find({ userEmail: session.user.email })
      .toArray();
    const initialLeads: Lead[] = raw.map(l => ({
      id: l._id.toString(),
      name: l.name,
      email: l.email,
      phone: l.phone || "",
    }));
    return { props: { initialLeads } };
  };

