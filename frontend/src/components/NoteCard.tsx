import React, { useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, Calendar as CalIcon, Clock, Trash2, Save, X, Pin, PinOff } from "lucide-react";
import MarkdownView, { toggleTaskInMarkdown } from "@/components/MarkdownView";
import MarkdownEditor from "@/components/MarkdownEditor";
import LocationPicker from "@/components/LocationPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { tr } from "date-fns/locale";
import api from "@/lib/api";
import { toast } from "sonner";
import type { Note, LocationItem } from "@/types";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
  } catch { return iso; }
}
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  note: Note;
  locationMap: Record<string, LocationItem>;
  locations: LocationItem[];
  onDelete: (id: string) => void;
  onChanged: () => void;
  onLocationsChanged: () => void;
}

export default function NoteCard({ note, locationMap, locations, onDelete, onChanged, onLocationsChanged }: Props) {
  const loc = note.location_id ? locationMap[note.location_id] : null;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [busy, setBusy] = useState(false);

  // popover states
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [timePopoverOpen, setTimePopoverOpen] = useState(false);
  const [locPickerOpen, setLocPickerOpen] = useState(false);

  // time input value
  const createdDate = new Date(note.created_at);
  const timeValue = `${String(createdDate.getHours()).padStart(2, "0")}:${String(createdDate.getMinutes()).padStart(2, "0")}`;

  async function patch(payload: Partial<{ title: string; content: string; date: string; location_id: string | null; created_at: string }>) {
    try {
      await api.put(`/notes/${note.note_id}`, {
        title: payload.title ?? note.title,
        content: payload.content ?? note.content,
        date: payload.date ?? note.date,
        location_id: payload.location_id !== undefined ? payload.location_id : note.location_id,
        created_at: payload.created_at,
      });
      onChanged();
    } catch {
      toast.error("Güncellenemedi");
    }
  }

  async function onDateChange(d: Date | undefined) {
    if (!d) return;
    setDatePopoverOpen(false);
    await patch({ date: dateToIso(d) });
    toast.success("Tarih güncellendi");
  }

  async function onTimeChange(timeStr: string) {
    if (!/^\d{2}:\d{2}$/.test(timeStr)) return;
    const [h, m] = timeStr.split(":").map((x) => parseInt(x, 10));
    const d = new Date(note.created_at);
    d.setHours(h, m, 0, 0);
    await patch({ created_at: d.toISOString() });
    toast.success("Saat güncellendi");
  }

  async function onLocationSave({ name, lat, lng }: { name: string; lat: number; lng: number }) {
    try {
      const { data } = await api.post<LocationItem>("/locations", { name, lat, lng });
      onLocationsChanged();
      await patch({ location_id: data.location_id });
      toast.success("Konum güncellendi");
    } catch {
      toast.error("Konum kaydedilemedi");
    }
  }

  async function onLocationPickExisting(locationId: string) {
    await patch({ location_id: locationId || null });
    toast.success("Konum güncellendi");
  }

  async function togglePin() {
    try {
      await api.patch(`/notes/${note.note_id}/pin`);
      onChanged();
      toast.success(note.pinned ? "Sabitleme kaldırıldı" : "Sabitlendi");
    } catch {
      toast.error("Güncellenemedi");
    }
  }

  async function onTaskToggle(idx: number, checked: boolean) {
    const newContent = toggleTaskInMarkdown(note.content, idx, checked);
    await patch({ content: newContent });
  }

  async function saveEdit() {
    setBusy(true);
    try {
      await patch({ title, content });
      setEditing(false);
      toast.success("Kaydedildi");
    } finally { setBusy(false); }
  }

  function cancelEdit() {
    setTitle(note.title);
    setContent(note.content);
    setEditing(false);
  }

  return (
    <article
      className="note-card mb-4"
      data-testid={`note-card-${note.note_id}`}
      onDoubleClick={(e) => {
        // ignore double-click on interactive children
        const target = e.target as HTMLElement;
        if (target.closest("button, a, input, textarea, select, [role='button']")) return;
        if (!editing) setEditing(true);
      }}
    >
      <header className="flex items-center justify-between mb-2.5 gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Date pill */}
          <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
            <PopoverTrigger asChild>
              <button className="note-meta-pill" data-testid={`note-date-pill-${note.note_id}`}>
                <CalIcon className="w-3 h-3" strokeWidth={1.75} />
                {formatDate(note.date)}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0 bg-popover border-border" data-testid="date-popover">
              <Calendar
                mode="single"
                selected={new Date(note.date + "T00:00:00")}
                onSelect={onDateChange}
                locale={tr}
                weekStartsOn={1}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          {/* Time pill */}
          <Popover open={timePopoverOpen} onOpenChange={setTimePopoverOpen}>
            <PopoverTrigger asChild>
              <button className="note-meta-pill" data-testid={`note-time-pill-${note.note_id}`}>
                <Clock className="w-3 h-3" strokeWidth={1.75} />
                {formatTime(note.created_at)}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-48 p-3 bg-popover border-border" data-testid="time-popover">
              <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground mb-2">Saat</div>
              <Input
                type="time"
                defaultValue={timeValue}
                onChange={(e: any) => onTimeChange(e.target.value)}
                data-testid={`time-input-${note.note_id}`}
                className="font-mono"
              />
            </PopoverContent>
          </Popover>

          {/* Location pill */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="note-meta-pill"
                data-active={loc ? "true" : "false"}
                data-testid={`note-location-pill-${note.note_id}`}
              >
                <MapPin className="w-3 h-3" strokeWidth={1.75} />
                {loc ? loc.name : "Konum ekle"}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3 bg-popover border-border space-y-2" data-testid="location-popover">
              <div className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">Konum</div>
              <select
                value={note.location_id || ""}
                onChange={(e: any) => onLocationPickExisting(e.target.value)}
                className="w-full bg-secondary border border-border rounded-md px-2 py-1.5 text-sm font-mono"
                data-testid={`location-select-${note.note_id}`}
              >
                <option value="">— konum yok —</option>
                {locations.map((l) => (<option key={l.location_id} value={l.location_id}>{l.name}</option>))}
              </select>
              <Button
                variant="outline" size="sm" className="w-full rounded-md"
                onClick={() => setLocPickerOpen(true)}
                data-testid={`location-new-btn-${note.note_id}`}
              >
                <MapPin className="w-3 h-3 mr-1.5" strokeWidth={1.5} /> Yeni konum seç
              </Button>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!editing && (
            <Link
              to={`/note/${note.note_id}`}
              className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground hover:text-foreground px-2 py-1"
              data-testid={`note-open-${note.note_id}`}
            >
              Aç →
            </Link>
          )}
          <Button
            size="icon"
            variant="ghost"
            className={`h-7 w-7 ${note.pinned ? "text-[hsl(var(--accent-tag))]" : "text-muted-foreground hover:text-foreground"}`}
            onClick={togglePin}
            data-testid={`note-pin-${note.note_id}`}
            aria-label={note.pinned ? "Sabitlemeyi kaldır" : "Sabitle"}
            title={note.pinned ? "Sabitlemeyi kaldır" : "Sabitle"}
          >
            {note.pinned ? <PinOff className="w-3.5 h-3.5" strokeWidth={1.5} /> : <Pin className="w-3.5 h-3.5" strokeWidth={1.5} />}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" data-testid={`note-delete-${note.note_id}`}>
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-border rounded-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-serif">Notu sil?</AlertDialogTitle>
                <AlertDialogDescription>Bu işlem geri alınamaz.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>İptal</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(note.note_id)} className="bg-destructive">Sil</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      {editing ? (
        <div className="space-y-3" data-testid={`note-edit-${note.note_id}`}>
          <Input
            value={title}
            onChange={(e: any) => setTitle(e.target.value)}
            placeholder="Başlık (opsiyonel)"
            className="font-serif text-xl border-0 px-0 focus-visible:ring-0 shadow-none"
            data-testid={`edit-title-${note.note_id}`}
          />
          <MarkdownEditor value={content} onChange={setContent} placeholder="Markdown…" onSubmit={saveEdit} onCancel={cancelEdit} />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <kbd className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground font-mono">
              <span className="px-1.5 py-0.5 rounded border border-border bg-muted">Ctrl</span>
              {" + "}
              <span className="px-1.5 py-0.5 rounded border border-border bg-muted">Enter</span>
              {" "}ile kaydet · <span className="px-1.5 py-0.5 rounded border border-border bg-muted">Esc</span> ile iptal
            </kbd>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={cancelEdit} data-testid={`edit-cancel-${note.note_id}`}>
                <X className="w-3.5 h-3.5 mr-1" /> İptal
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={busy} data-testid={`edit-save-${note.note_id}`} className="bg-foreground text-background hover:bg-foreground/90 rounded-md">
                <Save className="w-3.5 h-3.5 mr-1" /> {busy ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {note.title && (
            <h2 className="font-serif text-xl mb-1.5 leading-tight tracking-tight">
              <Link to={`/note/${note.note_id}`} className="hover:text-[hsl(var(--accent-tag))] transition-colors">
                {note.title}
              </Link>
            </h2>
          )}
          <MarkdownView content={note.content} onTaskToggle={onTaskToggle} />
          <div className="mt-3 text-[10px] tracking-[0.15em] uppercase text-muted-foreground/60 font-mono select-none">
            Çift tıkla → düzenle
          </div>
        </>
      )}

      <LocationPicker
        open={locPickerOpen}
        onOpenChange={setLocPickerOpen}
        initial={loc ? { name: loc.name, lat: loc.lat, lng: loc.lng } : undefined}
        onSave={onLocationSave}
      />
    </article>
  );
}
