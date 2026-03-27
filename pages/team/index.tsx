// pages/team/index.tsx
// Team leaderboard + member management
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import toast from "react-hot-toast";

interface LeaderboardEntry {
  email: string;
  name: string;
  newLeads: number;
  bookedLeads: number;
  calls: number;
  isOwner: boolean;
}

interface TeamMember {
  _id: string;
  memberEmail: string;
  memberName: string;
  joinedAt: string;
}

export default function TeamPage() {
  const { data: session } = useSession();
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [month, setMonth] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [lbRes, memRes] = await Promise.all([
        fetch("/api/team/leaderboard"),
        fetch("/api/team/members"),
      ]);
      const lbData = await lbRes.json();
      const memData = await memRes.json();
      setBoard(lbData.board || []);
      setMonth(lbData.month || "");
      setMembers(memData.members || []);
    } catch {
      toast.error("Failed to load team data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteeEmail: inviteEmail }),
      });
      if (res.ok) {
        toast.success(`Invite sent to ${inviteEmail}`);
        setInviteEmail("");
      } else {
        const d = await res.json();
        toast.error(d.error || "Failed to send invite");
      }
    } catch {
      toast.error("Error sending invite");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (memberEmail: string) => {
    if (!confirm(`Remove ${memberEmail} from your team?`)) return;
    await fetch(`/api/team/members?memberEmail=${encodeURIComponent(memberEmail)}`, { method: "DELETE" });
    await fetchAll();
    toast.success("Member removed");
  };

  const medalEmoji = ["🥇", "🥈", "🥉"];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-8 max-w-3xl">
        <h1 className="text-2xl font-bold">Team Leaderboard</h1>

        {/* Leaderboard */}
        <div className="bg-[#0f172a] rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 text-indigo-400">
            {month ? `${month} Performance` : "This Month"}
          </h2>

          {loading ? (
            <p className="text-gray-400 text-sm">Loading...</p>
          ) : board.length === 0 ? (
            <p className="text-gray-400 text-sm">No team data yet. Invite teammates below.</p>
          ) : (
            <div className="space-y-3">
              {board.map((entry, i) => (
                <div
                  key={entry.email}
                  className="flex items-center justify-between bg-[#1e293b] rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{medalEmoji[i] || `#${i + 1}`}</span>
                    <div>
                      <p className="font-semibold text-white">{entry.name}</p>
                      <p className="text-xs text-gray-400">{entry.email}</p>
                    </div>
                  </div>
                  <div className="flex gap-6 text-center text-sm">
                    <div>
                      <p className="font-bold text-white">{entry.newLeads}</p>
                      <p className="text-gray-400 text-xs">Leads</p>
                    </div>
                    <div>
                      <p className="font-bold text-green-400">{entry.bookedLeads}</p>
                      <p className="text-gray-400 text-xs">Booked</p>
                    </div>
                    <div>
                      <p className="font-bold text-blue-400">{entry.calls}</p>
                      <p className="text-gray-400 text-xs">Calls</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Invite */}
        <div className="bg-[#0f172a] rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Invite a Teammate</h2>
          <div className="flex gap-3">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@email.com"
              className="flex-1 bg-[#1e293b] border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
            />
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {inviting ? "Sending..." : "Send Invite"}
            </button>
          </div>
        </div>

        {/* Members */}
        {members.length > 0 && (
          <div className="bg-[#0f172a] rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Team Members</h2>
            <div className="space-y-2">
              {members.map((m) => (
                <div
                  key={m._id}
                  className="flex items-center justify-between bg-[#1e293b] rounded-lg px-4 py-3"
                >
                  <div>
                    <p className="text-white font-semibold">{m.memberName}</p>
                    <p className="text-gray-400 text-xs">{m.memberEmail}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(m.memberEmail)}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
