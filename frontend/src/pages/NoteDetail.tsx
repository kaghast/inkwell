import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api from "@/lib/api";
import TopBar from "@/components/TopBar";
import MarkdownEditor from "@/components/MarkdownEditor";
import MarkdownView from "@/components/MarkdownView";
import MiniMap from "@/components/MiniMap";
import LocationPicker from "@/components/LocationPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, MapPin, Pencil, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Note, LocationItem } from "@/types";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [note, setNote] = useState<Note | null>(null);
  const [loc, setLoc] = useState<LocationItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { data } = await api.get<Note>(`/notes/${id}`);
        setNote(data);
        setTitle(data.title || "");
        setContent(data.content || "");
        setLocationId(data.location_id || null);
        const locsRes = await api.get<LocationItem[]>("/locations");
        setLocations(locsRes.data || []);
        if (data.location_id) {
          const found = (locsRes.data || []).find((l) => l.location_id === data.location_id);
          setLoc(found || null);
        }
      } catch {
        toast.error("Not bulunamadı");
        navigate("/");
      }
    })();
  }, [id, navigate]);

  async function save() {
    if (!note) return;
    setBusy(true);
    try {
      const { data } = await api.put<Note>(`/notes/${id}`, {
        title, content, date: note.date, location_id: locationId,
      });
      setNote(data);
      setEditing(false);
      setLoc(locations.find((l) => l.location_id === data.location_id) || null);
      toast.success("Kaydedildi");
    } catch {
      toast.error("Kayıt başarısız");
    } finally { setBusy(false); }
  }

  async function deleteNote() {
    await api.delete(`/notes/${id}`);
    toast.success("Silindi");
    navigate("/");
  }

  async function saveNewLocation({ name, lat, lng }: { name: string; lat: number; lng: number }) {
    try {
      const { data } = await api.post<LocationItem>("/locations", { name, lat, lng });
      setLocations((prev) => [data, ...prev]);
      setLocationId(data.location_id);
      setLoc(data);
    } catch {
      toast.error("Konum kaydedilemedi");
    }
  }

  if (!note) {
    return <div className="paper min-h-screen"><TopBar /></div>;
  }

  const dayLabel = new Date(note.date + "T00:00:00").toLocaleDateString("tr-TR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  return (
    <div className="paper min-h-screen flex flex-col">
      <TopBar />
      <main className="flex-1 max-w-3xl w-full mx-auto px-5 py-8" data-testid="note-detail">
        <button
          className="flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground mb-8"
          onClick={() => navigate(-1)}
          data-testid="note-back-btn"
        >
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.25} /> Geri
        </button>

        <div className="mb-4 text-xs text-muted-foreground font-mono">{dayLabel}</div>

        {editing ? (
          <div className="space-y-4">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Başlık"
              data-testid="edit-title-input"
              className="font-serif text-3xl border-0 px-0 focus-visible:ring-0 shadow-none"
            />
            <MarkdownEditor value={content} onChange={setContent} />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPicker(true)} data-testid="edit-location-btn" className="rounded-sm">
                  <MapPin className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.25} />
                  {loc ? loc.name : "Konum ekle"}
                </Button>
                {locations.length > 0 && (
                  <select
                    value={locationId || ""}
                    onChange={(e) => { setLocationId(e.target.value || null); setLoc(locations.find((l) => l.location_id === e.target.value) || null); }}
                    className="bg-secondary border border-border text-xs rounded-sm px-2 py-1 font-mono"
                  >
                    <option value="">— konum yok —</option>
                    {locations.map((l) => (<option key={l.location_id} value={l.location_id}>{l.name}</option>))}
                  </select>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => { setEditing(false); setTitle(note.title); setContent(note.content); }}>
                  <X className="w-3.5 h-3.5 mr-1.5" /> İptal
                </Button>
                <Button onClick={save} disabled={busy} data-testid="save-edit-btn" className="bg-foreground text-background hover:bg-foreground/90 rounded-sm">
                  <Save className="w-3.5 h-3.5 mr-1.5" /> {busy ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 mb-4">
              <h1 className="font-serif text-4xl sm:text-5xl tracking-tight leading-[1.05]" data-testid="note-title">
                {note.title || <span className="text-muted-foreground">Başlıksız</span>}
              </h1>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditing(true)} data-testid="edit-note-btn">
                  <Pencil className="w-4 h-4" strokeWidth={1.25} />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" data-testid="delete-note-btn">
                      <Trash2 className="w-4 h-4" strokeWidth={1.25} />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-border rounded-sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="font-serif">Notu sil?</AlertDialogTitle>
                      <AlertDialogDescription>Bu işlem geri alınamaz.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>İptal</AlertDialogCancel>
                      <AlertDialogAction onClick={deleteNote} className="bg-destructive">Sil</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            {loc && (
              <div className="mb-6">
                <Link to={`/location/${loc.location_id}`} className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground mb-2">
                  <MapPin className="w-3 h-3" strokeWidth={1.5} /> {loc.name}
                </Link>
                <MiniMap lat={loc.lat} lng={loc.lng} height={180} />
              </div>
            )}

            <MarkdownView content={note.content} />
          </>
        )}
      </main>
      <LocationPicker open={picker} onOpenChange={setPicker} onSave={saveNewLocation} />
    </div>
  );
}
