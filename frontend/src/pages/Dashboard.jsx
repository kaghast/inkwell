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

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Dashboard({ mode = "day" }) {
  // mode: 'day' | 'tag' | 'person' | 'location'
  const params = useParams();
  const navigate = useNavigate();

  const [notes, setNotes] = useState([]);
  const [tags, setTags] = useState([]);
  const [people, setPeople] = useState([]);
  const [locations, setLocations] = useState([]);
  const [calCounts, setCalCounts] = useState({});

  const todayInit = todayIso();
  const initDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayInit;

  const [selectedDate, setSelectedDate] = useState(initDate);
  const [calMonth, setCalMonth] = useState({
    year: parseInt(initDate.slice(0, 4)),
    month: parseInt(initDate.slice(5, 7)),
  });
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const locationMap = useMemo(() => {
    const m = {};
    locations.forEach((l) => (m[l.location_id] = l));
    return m;
  }, [locations]);

  const fetchAux = useCallback(async () => {
    const [t, p, l] = await Promise.all([
      api.get("/tags"),
      api.get("/people"),
      api.get("/locations"),
    ]);
    setTags(t.data); setPeople(p.data); setLocations(l.data);
  }, []);

  const fetchCalendar = useCallback(async (y, m) => {
    const { data } = await api.get("/notes/calendar", { params: { year: y, month: m } });
    setCalCounts(data || {});
  }, []);

  const fetchNotes = useCallback(async () => {
    const params_ = {};
    if (mode === "day") params_.date = selectedDate;
    if (mode === "tag") params_.tag = params.name;
    if (mode === "person") params_.person = params.name;
    if (mode === "location") params_.location_id = params.id;
    const { data } = await api.get("/notes", { params: params_ });
    setNotes(data || []);
  }, [mode, params.name, params.id, selectedDate]);

  useEffect(() => { fetchAux(); }, [fetchAux]);
  useEffect(() => { fetchCalendar(calMonth.year, calMonth.month); }, [calMonth, fetchCalendar]);
  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  function onSelectDate(iso) {
    setSelectedDate(iso);
    navigate(`/day/${iso}`);
    setRightOpen(false);
  }

  function onChangeMonth(delta) {
    setCalMonth((cm) => {
      let m = cm.month + delta;
      let y = cm.year;
      if (m > 12) { m = 1; y++; }
      if (m < 1) { m = 12; y--; }
      return { year: y, month: m };
    });
  }

  async function onDeleteNote(id) {
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
      const loc = locationMap[params.id];
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
        {/* Sidebar desktop */}
        <div className="hidden lg:block border-r border-border min-h-0 overflow-hidden">
          <Sidebar tags={tags} people={people} locations={locations} onChange={() => { fetchAux(); fetchNotes(); }} />
        </div>

        {/* Center */}
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
              <div className="text-center py-16 text-muted-foreground italic font-serif text-xl">
                Bu seçim için henüz not yok.
              </div>
            ) : (
              notes.map((n) => (
                <NoteCard key={n.note_id} note={n} locationMap={locationMap} onDelete={onDeleteNote} />
              ))
            )}
          </div>
        </main>

        {/* Calendar desktop */}
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

      {/* Mobile drawers */}
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
