// pages/admin/prospecting.tsx
// Admin panel for the prospecting system: platform senders, DOI lead pool, assignments, plans.
import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

type Tab = "senders" | "leads" | "assignments" | "plans" | "fb_subscriptions" | "meta_diagnostics";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d?: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-t border-b-2 transition ${
        active ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

// ── Tab 1: Platform Senders ───────────────────────────────────────────────────

interface Sender {
  _id: string;
  label: string;
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  dailyLimit: number;
  sentToday: number;
  active: boolean;
}

function SendersTab() {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [label, setLabel] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [dailyLimit, setDailyLimit] = useState("200");
  const [formErr, setFormErr] = useState("");

  const fetchSenders = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/platform-senders");
      const data = await res.json();
      setSenders(data.senders || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSenders(); }, []);

  const addSender = async () => {
    setFormErr("");
    if (!label || !fromName || !fromEmail || !smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      setFormErr("All fields are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/platform-senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, fromName, fromEmail, smtpHost, smtpPort, smtpUser, smtpPass, dailyLimit }),
      });
      const data = await res.json();
      if (!res.ok) { setFormErr(data.error || "Failed to add sender."); return; }
      setLabel(""); setFromName(""); setFromEmail(""); setSmtpHost(""); setSmtpPort("587");
      setSmtpUser(""); setSmtpPass(""); setDailyLimit("200");
      await fetchSenders();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    await fetch("/api/admin/platform-senders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active: !active }),
    });
    fetchSenders();
  };

  const deleteSender = async (id: string) => {
    if (!confirm("Delete this sender?")) return;
    await fetch("/api/admin/platform-senders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchSenders();
  };

  return (
    <div className="space-y-6">
      {/* Add Sender Form */}
      <div className="bg-[#1e293b] border border-gray-700 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-white">Add Platform Sender</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { label: "Label", val: label, set: setLabel, ph: "Sender A" },
            { label: "Display Name", val: fromName, set: setFromName, ph: "CoveCRM Outreach" },
            { label: "From Email", val: fromEmail, set: setFromEmail, ph: "outreach@covecrm.com" },
            { label: "SMTP Host", val: smtpHost, set: setSmtpHost, ph: "smtp.gmail.com" },
            { label: "SMTP Port", val: smtpPort, set: setSmtpPort, ph: "587" },
            { label: "SMTP Username", val: smtpUser, set: setSmtpUser, ph: "user@gmail.com" },
            { label: "SMTP Password", val: smtpPass, set: setSmtpPass, ph: "App password", pwd: true },
            { label: "Daily Limit", val: dailyLimit, set: setDailyLimit, ph: "200" },
          ].map(({ label: l, val, set, ph, pwd }) => (
            <div key={l}>
              <label className="text-xs text-gray-400 mb-1 block">{l}</label>
              <input
                type={pwd ? "password" : "text"}
                value={val}
                onChange={(e) => set(e.target.value)}
                placeholder={ph}
                className="w-full bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm"
              />
            </div>
          ))}
        </div>
        {formErr && <p className="text-sm text-red-400">{formErr}</p>}
        <button
          onClick={addSender}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded text-sm disabled:opacity-60"
        >
          {saving ? "Adding…" : "Add Sender"}
        </button>
      </div>

      {/* Senders Table */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : senders.length === 0 ? (
        <p className="text-gray-500 text-sm">No platform senders yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="py-2 pr-4">Label</th>
                <th className="py-2 pr-4">From Email</th>
                <th className="py-2 pr-4">Host</th>
                <th className="py-2 pr-4">Daily Limit</th>
                <th className="py-2 pr-4">Sent Today</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {senders.map((s) => (
                <tr key={s._id} className="border-b border-gray-800">
                  <td className="py-2 pr-4 text-white">{s.label}</td>
                  <td className="py-2 pr-4 text-gray-300">{s.fromEmail}</td>
                  <td className="py-2 pr-4 text-gray-300">{s.smtpHost}</td>
                  <td className="py-2 pr-4 text-gray-300">{s.dailyLimit}</td>
                  <td className="py-2 pr-4 text-gray-300">{s.sentToday}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.active ? "bg-green-800 text-green-300" : "bg-gray-700 text-gray-400"}`}>
                      {s.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-2 flex gap-2">
                    <button onClick={() => toggleActive(s._id, s.active)} className="text-xs text-yellow-400 hover:underline">
                      {s.active ? "Pause" : "Activate"}
                    </button>
                    <button onClick={() => deleteSender(s._id)} className="text-xs text-red-400 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: DOI Lead Pool ──────────────────────────────────────────────────────

interface DOILeadRow {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  state: string;
  licenseType: string;
  scrapedAt?: string;
  lastAssignedAt?: string;
  cooldownUntil?: string;
  globallyUnsubscribed: boolean;
}

interface DOIStats {
  total: number;
  available: number;
  unsubscribed: number;
  onCooldown: number;
}

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

function LeadsTab() {
  const [leads, setLeads] = useState<DOILeadRow[]>([]);
  const [stats, setStats] = useState<DOIStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [stateFilter, setStateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState("");
  const [importingFL, setImportingFL] = useState(false);
  const [importingTX, setImportingTX] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  const fetchLeads = async (p = page, s = stateFilter, q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (s) params.set("state", s);
      if (q) params.set("search", q);
      const res = await fetch(`/api/admin/doi-leads?${params}`);
      const data = await res.json();
      setLeads(data.leads || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setStats(data.stats || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLeads(); }, []);

  const applyFilters = () => {
    setPage(1);
    setSearch(searchInput);
    fetchLeads(1, stateFilter, searchInput);
  };

  const importLeads = async (states: string[], setLoading: (v: boolean) => void) => {
    setLoading(true);
    setImportMsg("");
    try {
      const res = await fetch("/api/admin/import-leads-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ states }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const parts = Object.entries(data.results as Record<string, { imported: number; updated: number; errors: number }>)
          .map(([state, r]) => `${state}: +${r.imported} new, ${r.updated} updated, ${r.errors} errors`)
          .join(" | ");
        setImportMsg(parts);
        fetchLeads(page, stateFilter, search);
      } else {
        setImportMsg(data.error || "Import failed.");
      }
    } catch (e: any) {
      setImportMsg(e?.message || "Request failed.");
    } finally {
      setLoading(false);
    }
  };

  const runScraper = async () => {
    setScraping(true);
    setScrapeMsg("");
    try {
      const res = await fetch("/api/admin/run-doi-scraper", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setScrapeMsg(`Done. Scraped=${data.totalScraped} Inserted=${data.totalInserted} Updated=${data.totalUpdated} Errors=${data.totalErrors}`);
        fetchLeads(page, stateFilter, search);
      } else {
        setScrapeMsg(data.error || "Scraper failed.");
      }
    } catch (e: any) {
      setScrapeMsg(e?.message || "Request failed.");
    } finally {
      setScraping(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Leads", val: stats.total },
            { label: "Available Today", val: stats.available },
            { label: "Unsubscribed", val: stats.unsubscribed },
            { label: "On Cooldown", val: stats.onCooldown },
          ].map((s) => (
            <div key={s.label} className="bg-[#1e293b] border border-gray-700 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className="text-xl font-bold text-white">{s.val.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters + Scraper */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">State</label>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm"
          >
            <option value="">All States</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Search</label>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            placeholder="Name or email…"
            className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm w-48"
          />
        </div>
        <button onClick={applyFilters} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm">Filter</button>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {(scrapeMsg || importMsg) && (
            <span className="text-xs text-gray-400">{importMsg || scrapeMsg}</span>
          )}
          <button
            onClick={() => importLeads(["FL"], setImportingFL)}
            disabled={importingFL || importingTX}
            className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-60"
          >
            {importingFL ? "Importing FL…" : "Import FL Leads"}
          </button>
          <button
            onClick={() => importLeads(["TX"], setImportingTX)}
            disabled={importingFL || importingTX}
            className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-60"
          >
            {importingTX ? "Importing TX…" : "Import TX Leads"}
          </button>
          <button
            onClick={runScraper}
            disabled={scraping || importingFL || importingTX}
            className="bg-green-700 hover:bg-green-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-60"
          >
            {scraping ? "Scraping…" : "Run Scraper Now"}
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : leads.length === 0 ? (
        <p className="text-gray-500 text-sm">No leads match your filters.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">{total.toLocaleString()} total results</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">State</th>
                  <th className="py-2 pr-4">License</th>
                  <th className="py-2 pr-4">Scraped</th>
                  <th className="py-2 pr-4">Last Assigned</th>
                  <th className="py-2 pr-4">Cooldown Until</th>
                  <th className="py-2">Unsub</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l._id} className="border-b border-gray-800 hover:bg-[#1e293b]">
                    <td className="py-2 pr-4 text-white">{l.firstName} {l.lastName}</td>
                    <td className="py-2 pr-4 text-gray-300 text-xs">{l.email}</td>
                    <td className="py-2 pr-4 text-gray-300">{l.state}</td>
                    <td className="py-2 pr-4 text-gray-300 text-xs">{l.licenseType}</td>
                    <td className="py-2 pr-4 text-gray-400 text-xs">{fmt(l.scrapedAt)}</td>
                    <td className="py-2 pr-4 text-gray-400 text-xs">{fmt(l.lastAssignedAt)}</td>
                    <td className="py-2 pr-4 text-gray-400 text-xs">{fmt(l.cooldownUntil)}</td>
                    <td className="py-2">
                      {l.globallyUnsubscribed
                        ? <span className="text-xs text-red-400">Yes</span>
                        : <span className="text-xs text-gray-500">No</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex gap-2 items-center">
            <button
              onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchLeads(p, stateFilter, search); }}
              disabled={page <= 1}
              className="text-xs text-gray-400 hover:text-white disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-xs text-gray-400">Page {page} of {pages}</span>
            <button
              onClick={() => { const p = Math.min(pages, page + 1); setPage(p); fetchLeads(p, stateFilter, search); }}
              disabled={page >= pages}
              className="text-xs text-gray-400 hover:text-white disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab 3: Assignments ────────────────────────────────────────────────────────

interface Assignment {
  _id: string;
  assignedAt: string;
  userEmail: string;
  doiLeadId: { firstName?: string; lastName?: string; email?: string; state?: string } | null;
  status: string;
  folderId?: string;
}

function AssignmentsTab() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [emailFilter, setEmailFilter] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchAssignments = async (p = page, email = emailFilter, status = statusFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (email) params.set("userEmail", email);
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/assignments?${params}`);
      const data = await res.json();
      setAssignments(data.assignments || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAssignments(); }, []);

  const applyFilters = () => {
    setPage(1);
    setEmailFilter(emailInput);
    fetchAssignments(1, emailInput, statusFilter);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">User Email</label>
          <input
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            placeholder="Filter by email…"
            className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm w-52"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm"
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Bounced</option>
          </select>
        </div>
        <button onClick={applyFilters} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm">Filter</button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : assignments.length === 0 ? (
        <p className="text-gray-500 text-sm">No assignments found.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">{total.toLocaleString()} total</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="py-2 pr-4">Assigned</th>
                  <th className="py-2 pr-4">Agent</th>
                  <th className="py-2 pr-4">Lead Name</th>
                  <th className="py-2 pr-4">Lead Email</th>
                  <th className="py-2 pr-4">State</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Folder</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => {
                  const lead = a.doiLeadId;
                  return (
                    <tr key={a._id} className="border-b border-gray-800 hover:bg-[#1e293b]">
                      <td className="py-2 pr-4 text-gray-400 text-xs">{fmt(a.assignedAt)}</td>
                      <td className="py-2 pr-4 text-gray-300 text-xs">{a.userEmail}</td>
                      <td className="py-2 pr-4 text-white">{lead ? `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || "—" : "—"}</td>
                      <td className="py-2 pr-4 text-gray-300 text-xs">{lead?.email || "—"}</td>
                      <td className="py-2 pr-4 text-gray-300">{lead?.state || "—"}</td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          a.status === "active" ? "bg-green-800 text-green-300" :
                          a.status === "unsubscribed" ? "bg-red-800 text-red-300" :
                          "bg-gray-700 text-gray-400"
                        }`}>{a.status}</span>
                      </td>
                      <td className="py-2 text-xs text-gray-400">{a.folderId ? String(a.folderId).slice(-6) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchAssignments(p, emailFilter, statusFilter); }} disabled={page <= 1} className="text-xs text-gray-400 hover:text-white disabled:opacity-40">← Prev</button>
            <span className="text-xs text-gray-400">Page {page} of {pages}</span>
            <button onClick={() => { const p = Math.min(pages, page + 1); setPage(p); fetchAssignments(p, emailFilter, statusFilter); }} disabled={page >= pages} className="text-xs text-gray-400 hover:text-white disabled:opacity-40">Next →</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab 4: Plans ──────────────────────────────────────────────────────────────

interface Plan {
  _id: string;
  userEmail: string;
  planTier: number;
  leadsIncluded: number;
  leadsAssigned: number;
  leadsRemaining: number;
  status: string;
  periodStart: string;
  periodEnd: string;
}

function PlansTab() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  const fetchPlans = async (status = statusFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/plans?${params}`);
      const data = await res.json();
      setPlans(data.plans || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPlans(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); fetchPlans(e.target.value); }}
            className="bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm"
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : plans.length === 0 ? (
        <p className="text-gray-500 text-sm">No plans found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="py-2 pr-4">Agent</th>
                <th className="py-2 pr-4">Tier</th>
                <th className="py-2 pr-4">Included</th>
                <th className="py-2 pr-4">Assigned</th>
                <th className="py-2 pr-4">Remaining</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Period Start</th>
                <th className="py-2">Period End</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p._id} className="border-b border-gray-800 hover:bg-[#1e293b]">
                  <td className="py-2 pr-4 text-white text-xs">{p.userEmail}</td>
                  <td className="py-2 pr-4 text-gray-300">{p.planTier}</td>
                  <td className="py-2 pr-4 text-gray-300">{p.leadsIncluded}</td>
                  <td className="py-2 pr-4 text-gray-300">{p.leadsAssigned}</td>
                  <td className="py-2 pr-4 text-gray-300">{p.leadsRemaining}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      p.status === "active" ? "bg-green-800 text-green-300" :
                      p.status === "expired" ? "bg-yellow-800 text-yellow-300" :
                      "bg-red-800 text-red-300"
                    }`}>{p.status}</span>
                  </td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">{fmt(p.periodStart)}</td>
                  <td className="py-2 text-gray-400 text-xs">{fmt(p.periodEnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab 5: FB Subscriptions ───────────────────────────────────────────────────

interface FBSub {
  _id: string;
  userEmail: string;
  plan: string;
  status: string;
  currentPeriodEnd?: string;
  stripeSubscriptionId?: string;
}

function FBSubscriptionsTab() {
  const [subs, setSubs] = useState<FBSub[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/fb-subscriptions");
        const data = await res.json();
        setSubs(data.subscriptions || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const statusColor = (s: string) => {
    if (s === "active") return "bg-green-800 text-green-300";
    if (s === "trialing") return "bg-yellow-800 text-yellow-300";
    return "bg-red-800 text-red-300";
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : subs.length === 0 ? (
        <p className="text-gray-500 text-sm">No FB Lead Manager subscriptions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <p className="text-xs text-gray-500 mb-2">{subs.length} subscription{subs.length !== 1 ? "s" : ""}</p>
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Period End</th>
                <th className="py-2">Stripe Subscription ID</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s._id} className="border-b border-gray-800 hover:bg-[#1e293b]">
                  <td className="py-2 pr-4 text-white text-xs">{s.userEmail}</td>
                  <td className="py-2 pr-4 text-gray-300 capitalize">{s.plan.replace("_", " ")}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(s.status)}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">{fmt(s.currentPeriodEnd)}</td>
                  <td className="py-2 text-gray-500 text-xs font-mono">{s.stripeSubscriptionId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab 6: Meta Diagnostics ───────────────────────────────────────────────────

interface MetaDiagData {
  totalUsersWithMeta: number;
  totalActiveFBSubs: number;
  totalMetaLeads: number;
  expiredTokens: number;
  recentWebhookUsers: number;
  users: {
    email: string;
    pageId: string;
    adAccountId: string;
    tokenExpiresAt?: string;
    lastWebhookAt?: string;
    lastInsightSyncAt?: string;
    hasActiveSub: boolean;
    metaLeadCount: number;
  }[];
}

function MetaDiagnosticsTab() {
  const [data, setData] = useState<MetaDiagData | null>(null);
  const [loading, setLoading] = useState(true);
  const [testEmail, setTestEmail] = useState("");
  const [testLeadgenId, setTestLeadgenId] = useState("");
  const [testPageId, setTestPageId] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string>("");

  const fetchDiag = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/meta-diagnostics");
      const d = await res.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDiag(); }, []);

  const testWebhook = async () => {
    setTesting(true);
    setTestResult("");
    try {
      const res = await fetch("/api/admin/test-meta-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userEmail: testEmail, leadgenId: testLeadgenId, pageId: testPageId }),
      });
      const d = await res.json();
      setTestResult(res.ok ? `OK: ${JSON.stringify(d)}` : `Error: ${d.error || "unknown"}`);
    } catch (e: any) {
      setTestResult(`Network error: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  const syncAll = async () => {
    setSyncing(true);
    setSyncResult("");
    try {
      const res = await fetch("/api/admin/sync-meta-insights", { method: "POST" });
      const d = await res.json();
      setSyncResult(res.ok ? `Synced ${d.synced ?? 0} users.` : `Error: ${d.error || "unknown"}`);
    } finally {
      setSyncing(false);
    }
  };

  const isExpiringSoon = (exp?: string) => {
    if (!exp) return false;
    return new Date(exp).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;
  };

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : !data ? (
        <p className="text-red-400 text-sm">Failed to load diagnostics.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Users w/ Meta", value: data.totalUsersWithMeta },
              { label: "Active FB Subs", value: data.totalActiveFBSubs },
              { label: "Total Meta Leads", value: data.totalMetaLeads },
              { label: "Expired Tokens", value: data.expiredTokens, warn: data.expiredTokens > 0 },
              { label: "Recent Webhook", value: data.recentWebhookUsers },
            ].map(({ label, value, warn }) => (
              <div key={label} className="bg-[#1e293b] border border-gray-700 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className={`text-xl font-bold ${warn ? "text-yellow-400" : "text-white"}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* User table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Page ID</th>
                  <th className="py-2 pr-3">Ad Account</th>
                  <th className="py-2 pr-3">Token</th>
                  <th className="py-2 pr-3">Last Webhook</th>
                  <th className="py-2 pr-3">Last Sync</th>
                  <th className="py-2 pr-3">Sub</th>
                  <th className="py-2">Leads</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.email} className="border-b border-gray-800 hover:bg-[#1e293b]">
                    <td className="py-2 pr-3 text-white">{u.email}</td>
                    <td className="py-2 pr-3 text-gray-400 font-mono">{u.pageId || "—"}</td>
                    <td className="py-2 pr-3 text-gray-400 font-mono">{u.adAccountId || "—"}</td>
                    <td className="py-2 pr-3">
                      {!u.tokenExpiresAt ? (
                        <span className="text-emerald-400">Long-lived</span>
                      ) : isExpiringSoon(u.tokenExpiresAt) ? (
                        <span className="text-yellow-400">Expiring soon</span>
                      ) : (
                        <span className="text-emerald-400">Valid</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{u.lastWebhookAt ? new Date(u.lastWebhookAt).toLocaleDateString() : "Never"}</td>
                    <td className="py-2 pr-3 text-gray-500">{u.lastInsightSyncAt ? new Date(u.lastInsightSyncAt).toLocaleDateString() : "Never"}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${u.hasActiveSub ? "bg-green-800 text-green-300" : "bg-gray-700 text-gray-400"}`}>
                        {u.hasActiveSub ? "Active" : "None"}
                      </span>
                    </td>
                    <td className="py-2 text-gray-300">{u.metaLeadCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.users.length === 0 && (
              <p className="text-gray-500 text-sm py-4">No users with Meta connected yet.</p>
            )}
          </div>
        </>
      )}

      {/* Sync All */}
      <div className="bg-[#1e293b] border border-gray-700 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">Sync All Ad Insights</h3>
        <p className="text-xs text-gray-400">Trigger the meta insights cron for all connected users with active FB subscriptions.</p>
        <div className="flex items-center gap-3">
          <button
            onClick={syncAll}
            disabled={syncing}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm disabled:opacity-60"
          >
            {syncing ? "Syncing…" : "Sync All Now"}
          </button>
          {syncResult && <p className="text-xs text-emerald-400">{syncResult}</p>}
        </div>
      </div>

      {/* Test webhook */}
      <div className="bg-[#1e293b] border border-gray-700 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Test Meta Webhook</h3>
        <p className="text-xs text-gray-400">Manually trigger lead processing for a specific user and leadgen ID.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { label: "User Email", val: testEmail, set: setTestEmail, ph: "agent@example.com" },
            { label: "Leadgen ID", val: testLeadgenId, set: setTestLeadgenId, ph: "123456789" },
            { label: "Page ID", val: testPageId, set: setTestPageId, ph: "Page ID (optional)" },
          ].map(({ label, val, set, ph }) => (
            <div key={label}>
              <label className="text-xs text-gray-400 mb-1 block">{label}</label>
              <input
                type="text"
                value={val}
                onChange={(e) => set(e.target.value)}
                placeholder={ph}
                className="w-full bg-[#0f172a] border border-gray-600 rounded px-3 py-1.5 text-white text-sm"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={testWebhook}
            disabled={testing || !testEmail || !testLeadgenId}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded text-sm disabled:opacity-60"
          >
            {testing ? "Testing…" : "Run Test"}
          </button>
          {testResult && (
            <p className={`text-xs font-mono ${testResult.startsWith("OK") ? "text-emerald-400" : "text-rose-400"}`}>
              {testResult}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminProspectingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("senders");

  useEffect(() => {
    if (status === "unauthenticated") { router.push("/auth/signin"); return; }
    if (status === "authenticated" && session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
      router.push("/dashboard");
    }
  }, [status, session]);

  if (status !== "authenticated" || session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Admin nav */}
        <div className="flex flex-wrap gap-3 mb-2 border-b border-gray-700 pb-3">
          <span className="text-xs text-gray-500 self-center">Admin:</span>
          {[
            { label: "Numbers", href: "/admin/numbers" },
            { label: "Affiliate Codes", href: "/admin/affiliate-codes" },
            { label: "Affiliate Earnings", href: "/admin/affiliate-earnings" },
            { label: "Prospecting", href: "/admin/prospecting" },
          ].map((l) => (
            <a
              key={l.label}
              href={l.href}
              className={`text-xs px-3 py-1 rounded ${
                l.href === "/admin/prospecting"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {l.label}
            </a>
          ))}
        </div>

        <h1 className="text-2xl font-bold text-white">Prospecting Admin</h1>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-gray-700">
          <TabBtn active={tab === "senders"} onClick={() => setTab("senders")} label="Platform Senders" />
          <TabBtn active={tab === "leads"} onClick={() => setTab("leads")} label="DOI Lead Pool" />
          <TabBtn active={tab === "assignments"} onClick={() => setTab("assignments")} label="Assignments" />
          <TabBtn active={tab === "plans"} onClick={() => setTab("plans")} label="Plans" />
          <TabBtn active={tab === "fb_subscriptions"} onClick={() => setTab("fb_subscriptions")} label="FB Subscriptions" />
          <TabBtn active={tab === "meta_diagnostics"} onClick={() => setTab("meta_diagnostics")} label="Meta Diagnostics" />
        </div>

        <div>
          {tab === "senders" && <SendersTab />}
          {tab === "leads" && <LeadsTab />}
          {tab === "assignments" && <AssignmentsTab />}
          {tab === "plans" && <PlansTab />}
          {tab === "fb_subscriptions" && <FBSubscriptionsTab />}
          {tab === "meta_diagnostics" && <MetaDiagnosticsTab />}
        </div>
      </div>
    </DashboardLayout>
  );
}
