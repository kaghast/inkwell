import React, { useCallback, useEffect, useState } from "react";
import { CalendarCheck, ExternalLink, Loader2, Unplug } from "lucide-react";
import { AxiosError } from "axios";
import api, { googleSignIn } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { GoogleEvent } from "@/types";

interface Props {
  date: string; // YYYY-MM-DD (local day)
}

type Status = "loading" | "connected" | "disconnected";

function dayRange(date: string): { min: string; max: string } {
  const [y, m, d] = date.split("-").map((x) => parseInt(x, 10));
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 1);
  return { min: start.toISOString(), max: end.toISOString() };
}

function fmtTime(ev: GoogleEvent): string {
  if (ev.all_day) return "Tüm gün";
  const s = new Date(ev.start);
  const e = new Date(ev.end);
  const f = (x: Date) => x.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  return `${f(s)}–${f(e)}`;
}

export default function GoogleCalendarPanel({ date }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [events, setEvents] = useState<GoogleEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get<{ connected: boolean }>("/google/calendar/status")
      .then(({ data }) => alive && setStatus(data.connected ? "connected" : "disconnected"))
      .catch(() => alive && setStatus("disconnected"));
    return () => { alive = false; };
  }, []);

  const loadEvents = useCallback(async () => {
    const { min, max } = dayRange(date);
    setLoadingEvents(true);
    try {
      const { data } = await api.get<GoogleEvent[]>("/google/calendar/events", { params: { time_min: min, time_max: max } });
      setEvents(data || []);
    } catch (err) {
      if ((err as AxiosError).response?.status === 409) {
        setStatus("disconnected"); // access was revoked on Google's side
      } else {
        setEvents([]);
      }
    } finally {
      setLoadingEvents(false);
    }
  }, [date]);

  useEffect(() => {
    if (status === "connected") loadEvents();
  }, [status, loadEvents]);

  async function disconnect() {
    try {
      await api.delete("/google/calendar");
      setStatus("disconnected");
      setEvents([]);
      toast.success("Google Takvim bağlantısı kaldırıldı");
    } catch {
      toast.error("Bağlantı kaldırılamadı");
    }
  }

  return (
    <div className="border-b border-border px-6 py-5" data-testid="google-calendar-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-[10px] tracking-[0.3em] uppercase text-muted-foreground">
          <CalendarCheck className="w-3 h-3" strokeWidth={1.75} /> Google Takvim
        </div>
        {status === "connected" && (
          <button
            onClick={disconnect}
            title="Bağlantıyı kaldır"
            className="text-muted-foreground hover:text-foreground"
            data-testid="gcal-disconnect-btn"
          >
            <Unplug className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {status === "loading" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}

      {status === "disconnected" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Takviminizdeki etkinlikleri günlüğünüzün yanında görün. İzni bir kez vermeniz yeterli.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full rounded-sm"
            onClick={() => googleSignIn({ next: window.location.pathname, calendar: true })}
            data-testid="gcal-connect-btn"
          >
            Google Takvim'i bağla
          </Button>
        </div>
      )}

      {status === "connected" && (
        loadingEvents ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : events.length === 0 ? (
          <p className="text-xs text-muted-foreground font-serif">Bu gün için etkinlik yok.</p>
        ) : (
          <ul className="space-y-2" data-testid="gcal-events">
            {events.map((ev) => (
              <li key={ev.id} className="text-sm leading-snug">
                <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(ev)}</div>
                <div className="flex items-start gap-1">
                  <span className="flex-1 min-w-0 break-words">{ev.summary}</span>
                  {ev.html_link && (
                    <a href={ev.html_link} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground mt-0.5">
                      <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                    </a>
                  )}
                </div>
                {ev.location && <div className="text-[11px] text-muted-foreground truncate">{ev.location}</div>}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
