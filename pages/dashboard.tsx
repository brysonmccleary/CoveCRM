import { GetServerSideProps, GetServerSidePropsContext } from "next";
import { getSession } from "next-auth/react";
import clientPromise from "../lib/mongodb";

interface Lead { id: string; name: string; email: string; phone: string; }
interface DashboardProps { initialLeads: Lead[]; }

export const getServerSideProps: GetServerSideProps<DashboardProps> =
  async (context: GetServerSidePropsContext) => {
    const session = await getSession(context);
    if (!session || !session.user?.email) {
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

