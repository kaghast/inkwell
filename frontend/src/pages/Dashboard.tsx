import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import Sidebar from "@/components/Sidebar";
import CalendarPanel from "@/components/CalendarPanel";
import NoteCard from "@/components/NoteCard";
import NoteComposer from "@/components/NoteComposer";
import TopBar from "@/components/TopBar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Hash, AtSign, MapPin } from "lucide-react";
import type { Note, Tag, Person, LocationItem, CalendarCounts, DashboardMode } from "@/types";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  mode?: DashboardMode;
}

export default function Dashboard({ mode = "day" }: Props) {
  const params = useParams<{ date?: string; name?: string; id?: string }>();
  const navigate = useNavigate();

  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [calCounts, setCalCounts] = useState<CalendarCounts>({});

  const todayInit = todayIso();
  const initDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayInit;

  const [selectedDate, setSelectedDate] = useState<string>(initDate);
  const [calMonth, setCalMonth] = useState<{ year: number; month: number }>({
    year: parseInt(initDate.slice(0, 4)),
    month: parseInt(initDate.slice(5, 7)),
  });
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const locationMap = useMemo(() => {
    const m: Record<string, LocationItem> = {};
    locations.forEach((l) => (m[l.location_id] = l));
    return m;
  }, [locations]);

  const fetchAux = useCallback(async () => {
    const [t, p, l] = await Promise.all([
      api.get<Tag[]>("/tags"),
      api.get<Person[]>("/people"),
      api.get<LocationItem[]>("/locations"),
    ]);
    setTags(t.data); setPeople(p.data); setLocations(l.data);
  }, []);

  const fetchCalendar = useCallback(async (y: number, m: number) => {
    const { data } = await api.get<CalendarCounts>("/notes/calendar", { params: { year: y, month: m } });
    setCalCounts(data || {});
  }, []);

  const fetchNotes = useCallback(async () => {
    const q: Record<string, string> = {};
    if (mode === "day") q.date = selectedDate;
    if (mode === "tag" && params.name) q.tag = params.name;
    if (mode === "person" && params.name) q.person = params.name;
    if (mode === "location" && params.id) q.location_id = params.id;
    const { data } = await api.get<Note[]>("/notes", { params: q });
    setNotes(data || []);
  }, [mode, params.name, params.id, selectedDate]);

  useEffect(() => { fetchAux(); }, [fetchAux]);
  useEffect(() => { fetchCalendar(calMonth.year, calMonth.month); }, [calMonth, fetchCalendar]);
  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  function onSelectDate(iso: string) {
    setSelectedDate(iso);
    navigate(`/day/${iso}`);
    setRightOpen(false);
  }

  function onChangeMonth(delta: number) {
    setCalMonth((cm) => {
      let m = cm.month + delta;
      let y = cm.year;
      if (m > 12) { m = 1; y++; }
      if (m < 1) { m = 12; y--; }
      return { year: y, month: m };
    });
  }

  async function onDeleteNote(id: string) {
    await api.delete(`/notes/${id}`);
    fetchNotes();
    fetchCalendar(calMonth.year, calMonth.month);
    fetchAux();
  }

  function onNoteCreated() {
    fetchNotes();
    fetchCalendar(calMonth.year, calMonth.month);
    fetchAux();
  }

  function HeaderForMode() {
    if (mode === "tag") {
      return (
        <div className="mb-8">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
            <Hash className="w-3 h-3" strokeWidth={1.5} /> Etiket
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">
            <span className="text-[hsl(var(--accent-tag))]">#</span>{params.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{notes.length} not</p>
        </div>
      );
    }
    if (mode === "person") {
      return (
        <div className="mb-8">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
            <AtSign className="w-3 h-3" strokeWidth={1.5} /> Kişi
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">
            <span className="text-[hsl(var(--accent-mention))]">@</span>{params.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{notes.length} not</p>
        </div>
      );
    }
    if (mode === "location") {
      const loc = params.id ? locationMap[params.id] : null;
      return (
        <div className="mb-8">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
            <MapPin className="w-3 h-3" strokeWidth={1.5} /> Konum
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">{loc?.name || "Konum"}</h1>
          <p className="text-sm text-muted-foreground mt-1">{notes.length} not</p>
        </div>
      );
    }
    const d = new Date(selectedDate + "T00:00:00");
    const dayLabel = d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return (
      <div className="mb-8">
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-2">Günce</div>
        <h1 className="font-serif text-4xl sm:text-5xl tracking-tight" data-testid="day-heading">{dayLabel}</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono">{notes.length} not</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col paper">
      <TopBar onLeftMenu={() => setLeftOpen(true)} onRightMenu={() => setRightOpen(true)} />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] min-h-0">
        <div className="hidden lg:block border-r border-border min-h-0 overflow-hidden">
          <Sidebar tags={tags} people={people} locations={locations} onChange={() => { fetchAux(); fetchNotes(); }} />
        </div>

        <main className="min-w-0 max-w-3xl w-full mx-auto px-5 lg:px-10 py-8" data-testid="main-feed">
          <HeaderForMode />

          {mode === "day" && (
            <div className="mb-8">
              <NoteComposer
                defaultDate={selectedDate}
                locations={locations}
                onCreated={onNoteCreated}
                onLocationsChanged={fetchAux}
              />
            </div>
          )}

          <div>
            {notes.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground font-serif text-xl">
                Bu seçim için henüz not yok.
              </div>
            ) : (
              notes.map((n) => (
                <NoteCard
                  key={n.note_id}
                  note={n}
                  locationMap={locationMap}
                  locations={locations}
                  onDelete={onDeleteNote}
                  onChanged={() => { fetchNotes(); fetchCalendar(calMonth.year, calMonth.month); fetchAux(); }}
                  onLocationsChanged={fetchAux}
                />
              ))
            )}
          </div>
        </main>

        <div className="hidden lg:block border-l border-border min-h-0 overflow-hidden">
          <CalendarPanel
            year={calMonth.year}
            month={calMonth.month}
            counts={calCounts}
            selectedDate={mode === "day" ? selectedDate : null}
            onSelectDate={onSelectDate}
            onChangeMonth={onChangeMonth}
          />
        </div>
      </div>

      <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
        <SheetContent side="left" className="w-[280px] p-0 bg-background border-border" data-testid="mobile-sidebar">
          <Sidebar tags={tags} people={people} locations={locations} onChange={() => { fetchAux(); fetchNotes(); }} />
        </SheetContent>
      </Sheet>
      <Sheet open={rightOpen} onOpenChange={setRightOpen}>
        <SheetContent side="right" className="w-[320px] p-0 bg-background border-border" data-testid="mobile-calendar">
          <CalendarPanel
            year={calMonth.year}
            month={calMonth.month}
            counts={calCounts}
            selectedDate={mode === "day" ? selectedDate : null}
            onSelectDate={onSelectDate}
            onChangeMonth={onChangeMonth}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
