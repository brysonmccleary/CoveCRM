import { useEffect, useState } from "react";
import { useRouter } from "next/router";

interface LeadReminder {
  _id: string;
  "First Name"?: string;
  "Last Name"?: string;
  Phone?: string;
  appointmentTime: string;
}

interface Props {
  leads: LeadReminder[];
  inDialSession?: boolean;
}

export default function ReminderBanner({ leads, inDialSession = false }: Props) {
  const [activeReminder, setActiveReminder] = useState<LeadReminder | null>(null);
  const [reminderType, setReminderType] = useState<"5min" | "30min" | null>(null);
  const [dismissedKeys, setDismissedKeys] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    const now = new Date();

    // Restore dismissed reminder keys from localStorage
    const stored = localStorage.getItem("dismissedReminders");
    if (stored) setDismissedKeys(JSON.parse(stored));

    for (const lead of leads) {
      if (!lead.appointmentTime) continue;

      const apptTime = new Date(lead.appointmentTime);
      const diffMin = (apptTime.getTime() - now.getTime()) / (1000 * 60); // in minutes

      const key5 = `${lead._id}-5`;
      const key30 = `${lead._id}-30`;

      if (diffMin > 4 && diffMin < 6 && !dismissedKeys.includes(key5)) {
        setActiveReminder(lead);
        setReminderType("5min");
        return;
      }

      if (diffMin > 29 && diffMin < 31 && !dismissedKeys.includes(key30)) {
        setActiveReminder(lead);
        setReminderType("30min");
        return;
      }
    }
  }, [leads]);

  const handleDismiss = () => {
    if (activeReminder && reminderType) {
      const dismissKey = `${activeReminder._id}-${reminderType === "5min" ? "5" : "30"}`;
      const updated = [...dismissedKeys, dismissKey];
      setDismissedKeys(updated);
      localStorage.setItem("dismissedReminders", JSON.stringify(updated));
      setActiveReminder(null);
      setReminderType(null);
    }
  };

  const goToLead = () => {
    if (!activeReminder) return;

    if (inDialSession) {
      const confirmLeave = confirm(
        "You're currently in a dial session. Are you sure you want to leave and view this lead?"
      );
      if (!confirmLeave) return;
    }

    // FIXED: route matches pages/lead/[id].tsx
    router.push(`/lead/${activeReminder._id}`);
  };

  if (!activeReminder || !reminderType) return null;

  return (
    <div
      className="bg-blue-600 text-white px-6 py-3 flex justify-between items-center z-50 fixed top-0 left-0 right-0 shadow-lg cursor-pointer"
      onClick={goToLead}
    >
      <div>
        📞 Appointment with{" "}
        <strong>
          {activeReminder["First Name"] || "Lead"}{" "}
          {activeReminder["Last Name"] || ""}
        </strong>{" "}
        in <strong>{reminderType === "5min" ? "less than 5 minutes" : "less than 30 minutes"}</strong>
        {activeReminder.Phone && ` – ${activeReminder.Phone}`}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
        className="text-xl font-bold hover:text-blue-100 ml-4"
      >
        ✕
      </button>
    </div>
  );
}
