// pages/team/index.tsx
// Team leaderboard + member management
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import toast from "react-hot-toast";

type Range = "today" | "7days" | "30days";

interface LeaderboardEntry {
  email: string;
  name: string;
  rank: number;
  isOwner: boolean;
  calls: number;
  connects: number;
  connectRate: number;
  talkTimeMinutes: number;
  smsCount: number;
  leadsAdded: number;
  appointmentsBooked: number;
}

interface TeamMember {
  _id: string;
  memberEmail: string;
  memberName: string;
  joinedAt: string;
}

interface TeamInvite {
  _id: string;
  inviteeEmail: string;
  createdAt: string;
}

interface RecentCall {
  _id: string;
  startedAt?: string;
  duration?: number;
  direction?: string;
  answeredBy?: string;
  aiOverview?: { outcome?: string };
  callSid?: string;
}

interface TopObjection {
  text: string;
  count: number;
  lastHeard: string | null;
}

interface AgentStats {
  memberEmail: string;
  totalDials: number;
  connectedCalls: number;
  talkTimeMinutes: number;
  avgCallDurationSec: number;
  appointmentsBooked: number;
  aiOverviewCount: number;
  recentCalls: RecentCall[];
  topObjections: TopObjection[];
}

const RANGE_LABELS: Record<Range, string> = {
  today: "Today",
  "7days": "7 Days",
  "30days": "30 Days",
};

const MEDAL = ["🥇", "🥈", "🥉"];

export default function TeamPage() {
  const { data: session } = useSession();
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [range, setRange] = useState<Range>("30days");
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [selectedMember, setSelectedMember] = useState<{ email: string; name: string } | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const openDrawer = async (email: string, name: string) => {
    setSelectedMember({ email, name });
    setAgentStats(null);
    setLoadingStats(true);
    try {
      const res = await fetch(`/api/team/member-stats?memberEmail=${encodeURIComponent(email)}`);
      if (res.ok) setAgentStats(await res.json());
    } catch {}
    setLoadingStats(false);
  };

  const fetchLeaderboard = async (r: Range) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/team/leaderboard?range=${r}`);
      const data = await res.json();
      setBoard(data.board || []);
    } catch {
      toast.error("Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  };

  const fetchMembers = async () => {
    try {
      const [memRes, invRes] = await Promise.all([
        fetch("/api/team/members"),
        fetch("/api/team/invites").catch(() => null),
      ]);
      const memData = await memRes.json();
      setMembers(memData.members || []);
      if (invRes?.ok) {
        const invData = await invRes.json();
        setInvites(invData.invites || []);
      }
    } catch {}
  };

  useEffect(() => {
    fetchLeaderboard(range);
    fetchMembers();
  }, []);

  const handleRangeChange = (r: Range) => {
    setRange(r);
    fetchLeaderboard(r);
  };

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
        fetchMembers();
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
    fetchMembers();
    toast.success("Member removed");
  };

  const allZero = board.every(
    (e) =>
      e.calls === 0 && e.smsCount === 0 && e.leadsAdded === 0 && e.appointmentsBooked === 0
  );

  const myEmail = session?.user?.email?.toLowerCase();

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-5xl">
        <h1 className="text-2xl font-bold">Team Leaderboard</h1>

        {/* Leaderboard */}
        <div className="bg-[#0f172a] rounded-xl p-6">
          {/* Range Toggle */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-indigo-400">Performance</h2>
            <div className="flex gap-1 bg-[#1e293b] rounded-lg p-1">
              {(["today", "7days", "30days"] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => handleRangeChange(r)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition ${
                    range === r
                      ? "bg-indigo-600 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {RANGE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <p className="text-gray-400 text-sm">Loading...</p>
          ) : board.length === 0 ? (
            <p className="text-gray-400 text-sm">No team data yet. Invite teammates below.</p>
          ) : allZero ? (
            <p className="text-gray-400 text-sm text-center py-6">No data for this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-left border-b border-white/10">
                    <th className="pb-3 pr-3">Rank</th>
                    <th className="pb-3 pr-4">Agent</th>
                    <th className="pb-3 pr-4 text-right">Dials</th>
                    <th className="pb-3 pr-4 text-right">Talk Time</th>
                    <th className="pb-3 pr-4 text-right">Connects</th>
                    <th className="pb-3 pr-4 text-right">Connect %</th>
                    <th className="pb-3 pr-4 text-right">SMS Sent</th>
                    <th className="pb-3 pr-4 text-right">Leads</th>
                    <th className="pb-3 text-right">Appts</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((entry) => {
                    const isMe = entry.email.toLowerCase() === myEmail;
                    return (
                      <tr
                        key={entry.email}
                        onClick={() => openDrawer(entry.email, entry.name === "You" ? (session?.user?.name || entry.email) : entry.name)}
                        className={`border-b border-white/5 cursor-pointer ${
                          isMe ? "bg-indigo-900/20" : "hover:bg-white/5"
                        } transition`}
                      >
                        <td className="py-3 pr-3 text-lg">
                          {MEDAL[entry.rank - 1] || `#${entry.rank}`}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="font-medium text-white">{entry.name}</div>
                          {entry.name !== entry.email && (
                            <div className="text-xs text-gray-500">{entry.email}</div>
                          )}
                          <div className="text-xs text-indigo-400 mt-0.5">View Profile →</div>
                        </td>
                        <td className="py-3 pr-4 text-right font-bold text-white">{entry.calls}</td>
                        <td className="py-3 pr-4 text-right text-gray-300">
                          {entry.talkTimeMinutes}m
                        </td>
                        <td className="py-3 pr-4 text-right text-blue-300">{entry.connects}</td>
                        <td className="py-3 pr-4 text-right text-yellow-300">
                          {entry.connectRate}%
                        </td>
                        <td className="py-3 pr-4 text-right text-purple-300">{entry.smsCount}</td>
                        <td className="py-3 pr-4 text-right text-cyan-300">{entry.leadsAdded}</td>
                        <td className="py-3 text-right font-bold text-green-400">
                          {entry.appointmentsBooked}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
              onKeyDown={(e) => e.key === "Enter" && handleInvite()}
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

        {/* Active Members */}
        {members.length > 0 && (
          <div className="bg-[#0f172a] rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Team Members</h2>
            <div className="space-y-2">
              {members.map((m) => (
                <div
                  key={m._id}
                  onClick={() => openDrawer(m.memberEmail, m.memberName || m.memberEmail)}
                  className="flex items-center justify-between bg-[#1e293b] rounded-lg px-4 py-3 cursor-pointer hover:bg-[#263348] transition"
                >
                  <div>
                    <p className="text-white font-semibold">{m.memberName || m.memberEmail}</p>
                    <p className="text-gray-400 text-xs">{m.memberEmail}</p>
                    {m.joinedAt && (
                      <p className="text-gray-600 text-xs">
                        Joined {new Date(m.joinedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full">
                      Active
                    </span>
                    <span className="text-xs text-indigo-400">View Profile →</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemove(m.memberEmail); }}
                      className="text-red-400 hover:text-red-300 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending Invites */}
        {invites.length > 0 && (
          <div className="bg-[#0f172a] rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4 text-yellow-400">Pending Invites</h2>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div
                  key={inv._id}
                  className="flex items-center justify-between bg-[#1e293b] rounded-lg px-4 py-3"
                >
                  <div>
                    <p className="text-white text-sm">{inv.inviteeEmail}</p>
                    <p className="text-gray-500 text-xs">
                      Invited {new Date(inv.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        await fetch("/api/team/invite", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ inviteeEmail: inv.inviteeEmail }),
                        });
                        toast.success(`Invite resent to ${inv.inviteeEmail}`);
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 border border-blue-800 px-2 py-1 rounded"
                    >
                      Resend
                    </button>
                    <button
                      onClick={async () => {
                        await fetch(`/api/team/invites/${inv._id}`, { method: "DELETE" }).catch(() => {});
                        setInvites((prev) => prev.filter((i) => i._id !== inv._id));
                        toast.success("Invite cancelled");
                      }}
                      className="text-xs text-red-400 hover:text-red-300 border border-red-800 px-2 py-1 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Agent Profile Drawer */}
      {selectedMember && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSelectedMember(null)}
          />
          <div className="relative w-full max-w-lg bg-[#0f172a] h-full overflow-y-auto shadow-2xl border-l border-white/10 flex flex-col">
            {/* Header */}
            <div className="sticky top-0 bg-[#0f172a] border-b border-white/10 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <p className="text-white font-bold text-base">{selectedMember.name}</p>
                <p className="text-gray-500 text-xs">{selectedMember.email}</p>
              </div>
              <button
                onClick={() => setSelectedMember(null)}
                className="text-gray-400 hover:text-white text-2xl leading-none font-light ml-4"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6 flex-1">
              {loadingStats ? (
                <p className="text-gray-400 text-sm">Loading profile...</p>
              ) : agentStats ? (
                <>
                  {/* Stats grid */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                      All-Time Performance
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {(
                        [
                          { label: "Total Dials", value: agentStats.totalDials },
                          { label: "Connected", value: agentStats.connectedCalls },
                          {
                            label: "Connect Rate",
                            value:
                              agentStats.totalDials > 0
                                ? `${Math.round((agentStats.connectedCalls / agentStats.totalDials) * 100)}%`
                                : "—",
                          },
                          { label: "Talk Time", value: `${agentStats.talkTimeMinutes}m` },
                          {
                            label: "Avg Duration",
                            value:
                              agentStats.avgCallDurationSec > 0
                                ? `${Math.floor(agentStats.avgCallDurationSec / 60)}m ${agentStats.avgCallDurationSec % 60}s`
                                : "—",
                          },
                          { label: "Appts Booked", value: agentStats.appointmentsBooked },
                          { label: "AI Overviews", value: agentStats.aiOverviewCount },
                        ] as { label: string; value: string | number }[]
                      ).map(({ label, value }) => (
                        <div key={label} className="bg-[#1e293b] rounded-lg px-4 py-3">
                          <p className="text-gray-400 text-xs mb-1">{label}</p>
                          <p className="text-white font-bold text-lg">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Top Objections */}
                  {agentStats.topObjections.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                        Top Objections
                      </p>
                      <div className="space-y-2">
                        {agentStats.topObjections.map((obj, i) => (
                          <div
                            key={i}
                            className="bg-[#1e293b] rounded-lg px-3 py-2 flex items-center justify-between gap-3"
                          >
                            <p className="text-white text-sm flex-1 capitalize">{obj.text}</p>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs font-bold text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded-full">
                                {obj.count}×
                              </span>
                              {obj.lastHeard && (
                                <span className="text-xs text-gray-600">
                                  {new Date(obj.lastHeard).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent Calls */}
                  {agentStats.recentCalls.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                        Recent Calls
                      </p>
                      <div className="space-y-1.5">
                        {agentStats.recentCalls.map((call) => {
                          const dur = call.duration || 0;
                          const durStr =
                            dur > 0
                              ? `${Math.floor(dur / 60)}m ${dur % 60}s`
                              : "0s";
                          return (
                            <div
                              key={call._id}
                              className="bg-[#1e293b] rounded-lg px-3 py-2 flex items-center justify-between"
                            >
                              <div>
                                <p className="text-white text-xs">
                                  {call.startedAt
                                    ? new Date(call.startedAt).toLocaleString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        hour: "numeric",
                                        minute: "2-digit",
                                      })
                                    : "—"}
                                </p>
                                {call.aiOverview?.outcome && (
                                  <p className="text-gray-500 text-xs">{call.aiOverview.outcome}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                <span>{durStr}</span>
                                <span
                                  className={
                                    call.direction === "inbound"
                                      ? "text-green-400"
                                      : "text-blue-400"
                                  }
                                >
                                  {call.direction === "inbound" ? "↙" : "↗"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">Could not load profile.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
