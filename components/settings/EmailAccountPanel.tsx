// components/settings/EmailAccountPanel.tsx
// Agent SMTP email account connection settings panel.
import { useEffect, useState } from "react";

interface ProviderHint {
  host: string;
  port: string;
  hint: React.ReactNode;
}

function detectProvider(email: string): ProviderHint | null {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return null;

  if (domain === "gmail.com") {
    return {
      host: "smtp.gmail.com",
      port: "587",
      hint: (
        <>
          <span className="font-medium text-gray-300">Gmail:</span> use{" "}
          <code className="text-blue-400">smtp.gmail.com</code>, port{" "}
          <code className="text-blue-400">587</code>. You must use a Gmail App Password — your
          regular password won&apos;t work.{" "}
          <a
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline hover:text-blue-300"
          >
            Generate one here
          </a>{" "}
          (Google Account → Security → App Passwords).
        </>
      ),
    };
  }

  if (domain === "yahoo.com") {
    return {
      host: "smtp.mail.yahoo.com",
      port: "587",
      hint: (
        <>
          <span className="font-medium text-gray-300">Yahoo Mail:</span> use{" "}
          <code className="text-blue-400">smtp.mail.yahoo.com</code>, port{" "}
          <code className="text-blue-400">587</code>. Use a Yahoo App Password — go to{" "}
          <span className="text-gray-300">myaccount.yahoo.com → Security → App Passwords</span>.
        </>
      ),
    };
  }

  if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com") {
    return {
      host: "smtp-mail.outlook.com",
      port: "587",
      hint: (
        <>
          <span className="font-medium text-gray-300">Outlook / Hotmail / Live:</span> use{" "}
          <code className="text-blue-400">smtp-mail.outlook.com</code>, port{" "}
          <code className="text-blue-400">587</code>. Use your Microsoft account password or an
          app password if you have two-step verification enabled.
        </>
      ),
    };
  }

  return {
    host: "",
    port: "",
    hint: (
      <>
        <span className="font-medium text-gray-300">Custom provider:</span> use your email
        provider&apos;s SMTP settings. Common ports are{" "}
        <code className="text-blue-400">587</code> (TLS) or{" "}
        <code className="text-blue-400">465</code> (SSL).
      </>
    ),
  };
}

interface SmtpStatus {
  connected: boolean;
  isVerified?: boolean;
  fromName?: string;
  fromEmail?: string;
  smtpHost?: string;
  verifiedAt?: string;
  lastUsedAt?: string;
}

export default function EmailAccountPanel() {
  const [status, setStatus] = useState<SmtpStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Form state
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch("/api/email/smtp-status");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleConnect = async () => {
    if (!fromName || !fromEmail || !smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      setFormMsg({ ok: false, text: "All fields are required." });
      return;
    }
    setConnecting(true);
    setFormMsg(null);
    try {
      const res = await fetch("/api/email/connect-smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromName, fromEmail, smtpHost, smtpPort: Number(smtpPort), smtpUser, smtpPass }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFormMsg({ ok: false, text: data.error || "Connection failed. Check your credentials." });
      } else {
        setFormMsg({ ok: true, text: "Email account connected successfully." });
        setSmtpPass("");
        await fetchStatus();
      }
    } catch {
      setFormMsg({ ok: false, text: "An unexpected error occurred." });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect your email account? Emails will fall back to the platform sender.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/email/connect-smtp", { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setStatus({ connected: false });
        setFormMsg(null);
      } else {
        alert(data.error || "Failed to disconnect.");
      }
    } catch {
      alert("An unexpected error occurred.");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded shadow space-y-6">
      <h2 className="text-xl font-bold">Email Account</h2>
      <p className="text-sm text-gray-500">
        Connect your personal SMTP account so emails are sent from your own address.
      </p>

      {/* ── Connection Status ── */}
      <div className="border rounded p-4 space-y-2">
        <h3 className="font-semibold text-lg">Connection Status</h3>
        {loadingStatus ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : status?.connected ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-green-500 text-lg">✓</span>
              <span className="text-sm font-medium text-green-600 dark:text-green-400">Connected</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              <span className="font-medium">From:</span> {status.fromName} &lt;{status.fromEmail}&gt;
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              <span className="font-medium">Host:</span> {status.smtpHost}
            </p>
            {status.verifiedAt && (
              <p className="text-sm text-gray-500">
                Verified {new Date(status.verifiedAt).toLocaleDateString()}
                {status.lastUsedAt && ` · Last used ${new Date(status.lastUsedAt).toLocaleDateString()}`}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-lg">○</span>
            <span className="text-sm text-gray-500">No email account connected</span>
          </div>
        )}
      </div>

      {/* ── Connect / Update Form ── */}
      <div className="border rounded p-4 space-y-4">
        <h3 className="font-semibold text-lg">{status?.connected ? "Update Connection" : "Connect Email Account"}</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              className="w-full border border-gray-600 rounded px-3 py-2 bg-[#0f172a] text-white text-sm"
              placeholder="Jane Smith"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">From Email</label>
            <input
              className="w-full border border-gray-600 rounded px-3 py-2 bg-[#0f172a] text-white text-sm"
              placeholder="jane@youragency.com"
              value={fromEmail}
              onChange={(e) => {
                const val = e.target.value;
                setFromEmail(val);
                const provider = detectProvider(val);
                if (provider?.host) setSmtpHost(provider.host);
                if (provider?.port) setSmtpPort(provider.port);
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">SMTP Host</label>
            <input
              className="w-full border border-gray-600 rounded px-3 py-2 bg-[#0f172a] text-white text-sm"
              placeholder="smtp.gmail.com"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">SMTP Port</label>
            <input
              type="number"
              className="w-full border border-gray-600 rounded px-3 py-2 bg-[#0f172a] text-white text-sm"
              placeholder="587"
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">SMTP Username</label>
            <input
              className="w-full border border-gray-600 rounded px-3 py-2 bg-[#0f172a] text-white text-sm"
              placeholder="jane@youragency.com"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">SMTP Password</label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                className="w-full border border-gray-600 rounded px-3 py-2 bg-[#0f172a] text-white text-sm pr-16"
                placeholder="App password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPass((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white"
              >
                {showPass ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500 border border-gray-700 rounded p-3 bg-[#0f172a]">
          {detectProvider(fromEmail)?.hint ?? (
            <>
              Enter your From Email above and we&apos;ll detect the correct SMTP settings
              automatically.
            </>
          )}
        </p>

        {formMsg && (
          <p className={`text-sm px-3 py-2 rounded ${formMsg.ok ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
            {formMsg.text}
          </p>
        )}

        <button
          onClick={handleConnect}
          disabled={connecting}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded text-sm font-medium disabled:opacity-60"
        >
          {connecting ? "Testing connection…" : "Test & Connect"}
        </button>
      </div>

      {/* ── Disconnect (only if connected) ── */}
      {status?.connected && (
        <div className="border border-red-800 rounded p-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-red-400">Disconnect Email Account</h3>
            <p className="text-xs text-gray-500 mt-0.5">Emails will fall back to the CoveCRM platform sender.</p>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded text-sm disabled:opacity-60"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      )}
    </div>
  );
}
