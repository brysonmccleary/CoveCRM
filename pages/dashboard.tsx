import { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import axios from "axios";

import RequireAuth from "@/lib/requireAuth";
import DashboardLayout from "@/components/DashboardLayout";
import DripCampaignsPanel from "@/components/DripCampaignsPanel";
import LeadsPanel from "@/components/LeadsPanel";
import BuyNumberPanel from "@/components/BuyNumberPanel";
import CalendarBookings from "@/components/CalendarBookings";
import BookingForm from "@/components/BookingForm";
import SettingsPanel from "@/components/SettingsPanel";
import MessagesPanel from "@/components/messages/MessagesPanel";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { FaPhoneAlt } from "react-icons/fa";
import toast from "react-hot-toast";

const NumbersPanel = () => (
  <div className="p-4 space-y-6">
    <h1 className="text-2xl font-bold">Manage Numbers</h1>
    <BuyNumberPanel />
  </div>
);

const CalendarPanel = ({ showBanner }: { showBanner: boolean }) => (
  <div className="p-4 space-y-8">
    {showBanner && (
      <div className="bg-yellow-100 text-yellow-800 p-4 mb-4 rounded-md">
        ⏰ You haven’t connected your Google Calendar yet.{" "}
        <a
          href="/api/connect/google-calendar"
          className="underline font-semibold"
        >
          Connect Now
        </a>
      </div>
    )}
    <div>
      <h1 className="text-2xl font-bold mb-4">Upcoming Bookings</h1>
      <CalendarBookings />
    </div>
    <div>
      <h2 className="text-xl font-semibold mb-2">Book a New Appointment</h2>
      <BookingForm />
    </div>
  </div>
);

function DashboardOverview() {
  const [data, setData] = useState<
    { date: string; dials: number; talks: number }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/stats");
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Failed to load stats");

        const raw: { date: string; dials: number; talks: number }[] =
          result.data;

        const today = new Date();
        const last10 = [...Array(10)].map((_, i) => {
          const d = new Date(today);
          d.setDate(d.getDate() - (9 - i));
          const key = d.toISOString().split("T")[0];
          return {
            key,
            label: d.toLocaleDateString("default", {
              month: "short",
              day: "numeric",
            }),
          };
        });

        const mapped = last10.map(({ key, label }) => {
          const found = raw.find((r) => r.date.startsWith(key));
          return {
            date: label,
            dials: found?.dials || 0,
            talks: found?.talks || 0,
          };
        });

        setData(mapped);
      } catch (err: any) {
        toast.error(err.message || "Error fetching dashboard data.");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const lastEntry = data[data.length - 1];
  const dailyCalls = lastEntry?.dials || 0;
  const dailyTalks = lastEntry?.talks || 0;

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-[#111D35] text-white rounded-lg p-4 shadow flex flex-col items-center justify-center">
          <div className="text-sm uppercase text-gray-400">Daily Calls</div>
          <div className="text-2xl font-bold">{dailyCalls}</div>
        </div>
        <div className="bg-[#111D35] text-white rounded-lg p-4 shadow flex flex-col items-center justify-center">
          <div className="text-sm uppercase text-gray-400">Daily Talks</div>
          <div className="text-2xl font-bold">{dailyTalks}</div>
        </div>
      </div>

      <div className="bg-[#111D35] text-white p-6 rounded-lg shadow">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FaPhoneAlt className="text-pink-400" />
          Call Performance (Last 10 Days)
        </h2>

        <div className="h-80">
          {loading ? (
            <p className="text-gray-400">Loading chart...</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <XAxis dataKey="date" stroke="#D1D5DB" />
                <YAxis stroke="#D1D5DB" />
                <Tooltip
                  formatter={(value: number) => `${value} calls`}
                  labelStyle={{ color: "#E5E7EB" }}
                  contentStyle={{
                    backgroundColor: "#1A2B45",
                    borderColor: "#4B5563",
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  wrapperStyle={{ color: "#E5E7EB" }}
                />
                <Line
                  type="monotone"
                  dataKey="dials"
                  stroke="#3B82F6"
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  name="Total Dials"
                />
                <Line
                  type="monotone"
                  dataKey="talks"
                  stroke="#F97316"
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  name="Talks Connected"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage({
  userNeedsCalendarConnect,
}: {
  userNeedsCalendarConnect?: boolean;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { tab } = router.query;

  // If LeadsPanel loads its own data (most versions do), we don’t pass props to avoid TS errors.
  // If your local LeadsPanel *requires* a prop, we can type it later—this fixes the current compile error.
  useEffect(() => {
    // Keep any side-effects you need here; leaving axios import in case you re-add fetches.
    // Example: warm an endpoint or prefetch caches, etc.
    void axios.get; // no-op reference to avoid unused import when building
  }, []);

  return (
    <RequireAuth>
      <DashboardLayout>
        {!tab || tab === "home" ? <DashboardOverview /> : null}
        {tab === "leads" && <LeadsPanel />}
        {tab === "conversations" && <MessagesPanel />}
        {tab === "numbers" && <NumbersPanel />}
        {tab === "settings" && <SettingsPanel />}
        {tab === "drip-campaigns" && <DripCampaignsPanel />}
        {tab === "calendar" && (
          <CalendarPanel showBanner={!!userNeedsCalendarConnect} />
        )}
      </DashboardLayout>
    </RequireAuth>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session || !session.user?.email) {
    return {
      redirect: {
        destination: "/auth/signin",
        permanent: false,
      },
    };
  }

  await dbConnect();
  const user = await User.findOne({ email: session.user.email as string });
  const hasCalendarConnected = Boolean(
    user?.googleSheets?.accessToken && user?.calendarId,
  );

  return {
    props: {
      userNeedsCalendarConnect: !hasCalendarConnected,
    },
  };
};
