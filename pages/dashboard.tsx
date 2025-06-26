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
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-3xl mb-6">Your Leads</h1>
      {/* We’ll flesh this out below */}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getSession(context);
  if (!session) {
    return { redirect: { destination: "/auth/signin", permanent: false } };
  }
  const db = await clientPromise;
  const rawLeads = await db
    .db()
    .collection("leads")
    .find({ userEmail: session.user.email })
    .toArray();
  const leads = rawLeads.map(l => ({
    _id: l._id.toString(),
    name: l.name,
    email: l.email,
    phone: l.phone || "",
  }));
  return { props: { leads } };
};

