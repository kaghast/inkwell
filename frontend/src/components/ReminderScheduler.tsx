import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, X } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

interface Reminder {
  reminder_id: string;
  note_id: string;
  at: string; // ISO
  text: string;
  fired: boolean;
}

interface FiredReminder extends Reminder {}

async function requestNotificationPermission() {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "default") {
    try { return await Notification.requestPermission(); } catch { return "denied"; }
  }
  return Notification.permission;
}

export default function ReminderScheduler() {
  const timeouts = useRef<Record<string, number>>({});
  const [firedList, setFiredList] = useState<FiredReminder[]>([]);
  const [scheduled, setScheduled] = useState<Reminder[]>([]);

  async function loadUpcoming() {
    try {
      const { data } = await api.get<Reminder[]>("/reminders/upcoming");
      setScheduled(data || []);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    requestNotificationPermission();
    loadUpcoming();
    // Refresh every minute in case new notes were added elsewhere
    const t = window.setInterval(loadUpcoming, 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    // Clear existing scheduled timeouts and rebuild
    Object.values(timeouts.current).forEach((h) => window.clearTimeout(h));
    timeouts.current = {};
    const now = Date.now();
    scheduled.forEach((r) => {
      const target = new Date(r.at).getTime();
      const delay = Math.max(0, target - now);
      if (delay > 12 * 60 * 60 * 1000) return; // only schedule within 12h
      timeouts.current[r.reminder_id] = window.setTimeout(async () => {
        fire(r);
      }, delay);
    });
    return () => {
      Object.values(timeouts.current).forEach((h) => window.clearTimeout(h));
    };
  }, [scheduled]);

  function fire(r: Reminder) {
    // Browser notification
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Inkwell — Hatırlatma", { body: r.text, tag: r.reminder_id });
      } catch { /* ignore */ }
    }
    // In-app popup
    setFiredList((prev) => (prev.some((x) => x.reminder_id === r.reminder_id) ? prev : [...prev, r]));
    toast.info(`Hatırlatma: ${r.text}`);
    // Mark on backend so we don't re-fire on reload
    api.post(`/reminders/${r.reminder_id}/fire`).catch(() => { /* ignore */ });
  }

  function dismiss(id: string) {
    setFiredList((prev) => prev.filter((x) => x.reminder_id !== id));
  }

  if (firedList.length === 0) return null;

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] space-y-2 max-w-md w-[min(90vw,28rem)]" data-testid="reminder-popup-stack">
      {firedList.map((r) => (
        <div
          key={r.reminder_id}
          className="flex items-start gap-3 rounded-lg border border-[hsl(var(--accent-tag)/0.3)] bg-card p-4 shadow-lg"
          data-testid={`reminder-popup-${r.reminder_id}`}
        >
          <BellRing className="w-4 h-4 text-[hsl(var(--accent-tag))] mt-0.5" strokeWidth={1.75} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">Hatırlatma</div>
            <div className="font-serif text-lg leading-tight mt-0.5">{r.text}</div>
            <div className="mt-2">
              <Link
                to={`/note/${r.note_id}`}
                className="text-xs underline text-[hsl(var(--accent-tag))]"
                onClick={() => dismiss(r.reminder_id)}
              >
                Notu aç →
              </Link>
            </div>
          </div>
          <button
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            onClick={() => dismiss(r.reminder_id)}
            data-testid={`reminder-dismiss-${r.reminder_id}`}
            aria-label="Kapat"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </div>
  );
}
