from pathlib import Path
import sys

path = Path("components/messages/ChatThread.tsx")
src = path.read_text(encoding="utf-8")

old_state = '''  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [resumingDrip, setResumingDrip] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const timeZone = useMemo(() => getAgentTimeZone(), []);
'''

new_state = '''  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [resumingDrip, setResumingDrip] = useState(false);
  const [dripUi, setDripUi] = useState<{
    loading: boolean;
    hasActive: boolean;
    hasResumable: boolean;
  }>({
    loading: true,
    hasActive: false,
    hasResumable: false,
  });
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const timeZone = useMemo(() => getAgentTimeZone(), []);
'''

if old_state not in src:
    print("[refuse] state block not found")
    sys.exit(1)

src = src.replace(old_state, new_state, 1)

anchor = '''  useEffect(() => {
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);
'''

insert = '''  useEffect(() => {
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    let cancelled = false;

    const fetchDripUi = async () => {
      if (!leadId) return;
      try {
        setDripUi((prev) => ({ ...prev, loading: true }));
        const res = await axios.get(`/api/drips/resume-status?leadId=${encodeURIComponent(leadId)}`);
        if (!cancelled) {
          setDripUi({
            loading: false,
            hasActive: !!res.data?.hasActive,
            hasResumable: !!res.data?.hasResumable,
          });
        }
      } catch {
        if (!cancelled) {
          setDripUi({
            loading: false,
            hasActive: false,
            hasResumable: false,
          });
        }
      }
    };

    fetchDripUi();
    return () => {
      cancelled = true;
    };
  }, [leadId]);
'''

if anchor not in src:
    print("[refuse] leadId effect anchor not found")
    sys.exit(1)

src = src.replace(anchor, insert, 1)

old_continue = '''  const handleContinueDrip = async () => {
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
'''

new_continue = '''  const handleContinueDrip = async () => {
    if (!leadId || resumingDrip || dripUi.hasActive) return;

    try {
      setResumingDrip(true);
      const res = await axios.post("/api/drips/resume-lead", { leadId });
      const campaignName = res?.data?.campaignName || "drip campaign";
      setDripUi({
        loading: false,
        hasActive: true,
        hasResumable: false,
      });
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
'''

if old_continue not in src:
    print("[refuse] continue handler not found")
    sys.exit(1)

src = src.replace(old_continue, new_continue, 1)

old_button_block = '''      <div className="flex items-center justify-end px-4 py-3 border-b border-gray-800 bg-[#0f172a]">
        <button
          onClick={handleContinueDrip}
          disabled={resumingDrip}
          className="bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 transition disabled:opacity-60"
        >
          {resumingDrip ? "Continuing..." : "Continue Drip"}
        </button>
      </div>
'''

new_button_block = '''      <div className="flex items-center justify-end px-4 py-3 border-b border-gray-800 bg-[#0f172a] min-h-[72px]">
        {dripUi.hasActive ? (
          <span className="bg-green-700 text-white px-4 py-2 rounded-full text-sm">
            Drip Active
          </span>
        ) : dripUi.hasResumable ? (
          <button
            onClick={handleContinueDrip}
            disabled={resumingDrip}
            className="bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 transition disabled:opacity-60"
          >
            {resumingDrip ? "Continuing..." : "Continue Drip"}
          </button>
        ) : null}
      </div>
'''

if old_button_block not in src:
    print("[refuse] button block not found")
    sys.exit(1)

src = src.replace(old_button_block, new_button_block, 1)

path.write_text(src, encoding="utf-8")
print("[patch] Updated Continue Drip button to show active/resumable states correctly")
