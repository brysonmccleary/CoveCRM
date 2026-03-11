from pathlib import Path
import sys

path = Path("components/messages/ChatThread.tsx")
src = path.read_text(encoding="utf-8")

old_state = '''export default function ChatThread({ leadId, socket }: ChatThreadProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const timeZone = useMemo(() => getAgentTimeZone(), []);
'''

new_state = '''export default function ChatThread({ leadId, socket }: ChatThreadProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [resumingDrip, setResumingDrip] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const timeZone = useMemo(() => getAgentTimeZone(), []);
'''

if old_state not in src:
    print("[refuse] state anchor not found")
    sys.exit(1)

src = src.replace(old_state, new_state, 1)

old_send = '''  const sendMessage = async () => {
    if (!input.trim()) return;

    const res = await axios.post("/api/message", {
      leadId,
      text: input.trim(),
      direction: "outbound",
    });

    const message = res.data.message;
    setMessages((prev) => (hasMsgId(prev, message) ? prev : [...prev, message]));
    setInput("");
    scrollToBottom();
  };

  return (
'''

new_send = '''  const sendMessage = async () => {
    if (!input.trim()) return;

    const res = await axios.post("/api/message", {
      leadId,
      text: input.trim(),
      direction: "outbound",
    });

    const message = res.data.message;
    setMessages((prev) => (hasMsgId(prev, message) ? prev : [...prev, message]));
    setInput("");
    scrollToBottom();
  };

  const handleContinueDrip = async () => {
    if (!leadId || resumingDrip) return;

    try {
      setResumingDrip(true);
      const res = await axios.post("/api/drips/resume-lead", { leadId });
      const campaignName = res?.data?.campaignName || "drip campaign";
      alert(`✅ Continued ${campaignName}`);
    } catch (err: any) {
      console.error("Continue drip failed", err);
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.detail ||
        "Could not continue drip";
      alert(msg);
    } finally {
      setResumingDrip(false);
    }
  };

  return (
'''

if old_send not in src:
    print("[refuse] send/return anchor not found")
    sys.exit(1)

src = src.replace(old_send, new_send, 1)

old_root = '''    <div className="flex flex-col h-full bg-[#0f172a]">
      <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col">
'''

new_root = '''    <div className="flex flex-col h-full bg-[#0f172a]">
      <div className="flex items-center justify-end px-4 py-3 border-b border-gray-800 bg-[#0f172a]">
        <button
          onClick={handleContinueDrip}
          disabled={resumingDrip}
          className="bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 transition disabled:opacity-60"
        >
          {resumingDrip ? "Continuing..." : "Continue Drip"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col">
'''

if old_root not in src:
    print("[refuse] root anchor not found")
    sys.exit(1)

src = src.replace(old_root, new_root, 1)

path.write_text(src, encoding="utf-8")
print("[patch] Added Continue Drip button to the real ChatThread UI")
