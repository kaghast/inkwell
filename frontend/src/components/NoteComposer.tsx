import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Plus, X } from "lucide-react";
import MarkdownEditor from "@/components/MarkdownEditor";
import LocationPicker from "@/components/LocationPicker";
import api from "@/lib/api";
import { toast } from "sonner";
import type { Note, LocationItem } from "@/types";

interface Props {
  defaultDate: string;
  locations: LocationItem[];
  onCreated: (n: Note) => void;
  onLocationsChanged?: () => void;
}

export default function NoteComposer({ defaultDate, locations, onCreated, onLocationsChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationDialog, setLocationDialog] = useState(false);
  const [busy, setBusy] = useState(false);

  function reset() {
    setTitle(""); setContent(""); setLocationId(null); setOpen(false);
  }

  async function save() {
    if (!content.trim() && !title.trim()) {
      toast.error("Boş not kaydedilemez");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post<Note>("/notes", {
        title, content, date: defaultDate, location_id: locationId,
      });
      onCreated(data);
      reset();
      toast.success("Not eklendi");
    } catch {
      toast.error("Kayıt başarısız");
    } finally { setBusy(false); }
  }

  async function saveNewLocation({ name, lat, lng }: { name: string; lat: number; lng: number }) {
    try {
      const { data } = await api.post<LocationItem>("/locations", { name, lat, lng });
      setLocationId(data.location_id);
      onLocationsChanged && onLocationsChanged();
      toast.success("Konum eklendi");
    } catch {
      toast.error("Konum kaydedilemedi");
    }
  }

  const selectedLoc = locations.find((l) => l.location_id === locationId);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-testid="open-composer-btn"
        className="w-full text-left border border-dashed border-border rounded-sm px-5 py-4 text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors flex items-center gap-2"
      >
        <Plus className="w-4 h-4" strokeWidth={1.25} />
        <span className="font-serif italic text-lg">Bugüne bir şeyler yaz...</span>
      </button>
    );
  }

  return (
    <div className="border border-border rounded-sm p-5 bg-card space-y-3" data-testid="note-composer">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Başlık (opsiyonel)"
        className="font-serif text-xl border-0 px-0 focus-visible:ring-0 shadow-none"
        data-testid="composer-title-input"
      />
      <MarkdownEditor
        value={content}
        onChange={setContent}
        placeholder="Markdown destekli. #etiket veya @kişi yazarak otomatik tamamlama..."
        autoFocus
        onSubmit={save}
      />
      <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLocationDialog(true)}
            data-testid="composer-add-location-btn"
            className="rounded-sm"
          >
            <MapPin className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.25} />
            {selectedLoc ? selectedLoc.name : "Konum ekle"}
          </Button>
          {locations.length > 0 && (
            <select
              value={locationId || ""}
              onChange={(e) => setLocationId(e.target.value || null)}
              className="bg-secondary border border-border text-xs rounded-sm px-2 py-1 font-mono"
              data-testid="composer-location-select"
            >
              <option value="">— önceki konum —</option>
              {locations.map((l) => (<option key={l.location_id} value={l.location_id}>{l.name}</option>))}
            </select>
          )}
          {selectedLoc && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setLocationId(null)}>
              <X className="w-3.5 h-3.5" strokeWidth={1.25} />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={reset} data-testid="composer-cancel-btn">İptal</Button>
          <Button onClick={save} disabled={busy} data-testid="composer-save-btn" className="bg-foreground text-background hover:bg-foreground/90 rounded-sm">
            {busy ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </div>
      </div>
      <LocationPicker open={locationDialog} onOpenChange={setLocationDialog} onSave={saveNewLocation} />
    </div>
  );
}
