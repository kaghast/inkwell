import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Hash, AtSign, MapPin, Pencil, Trash2, X, Check } from "lucide-react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function EditableRow({ icon: Icon, label, to, onRename, onDelete, accentClass, testid }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(label);
  const nav = useNavigate();

  async function save() {
    const trimmed = val.trim();
    if (!trimmed || trimmed === label) { setEditing(false); setVal(label); return; }
    try {
      await onRename(trimmed);
      toast.success("Güncellendi");
      setEditing(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Hata");
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 px-2 py-1" data-testid={`${testid}-edit-row`}>
        <Icon className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.25} />
        <Input
          value={val}
          autoFocus
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setVal(label); } }}
          className="h-7 text-sm font-mono rounded-sm"
        />
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={save}><Check className="w-3.5 h-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(false); setVal(label); }}><X className="w-3.5 h-3.5" /></Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between px-2 py-1 rounded-sm hover:bg-accent/50 transition-colors" data-testid={`${testid}-row`}>
      <button
        className="flex items-center gap-1.5 text-sm font-mono truncate text-left flex-1"
        onClick={() => nav(to)}
      >
        <Icon className={`w-3.5 h-3.5 ${accentClass}`} strokeWidth={1.25} />
        <span className="truncate">{label}</span>
      </button>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(true)} data-testid={`${testid}-edit-btn`}>
          <Pencil className="w-3 h-3" strokeWidth={1.25} />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" data-testid={`${testid}-delete-btn`}>
              <Trash2 className="w-3 h-3" strokeWidth={1.25} />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-card border-border rounded-sm">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-serif">Silinsin mi?</AlertDialogTitle>
              <AlertDialogDescription>&quot;{label}&quot; silinecek. Bu eylem geri alınamaz.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>İptal</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} className="bg-destructive">Sil</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export default function Sidebar({ tags, people, locations, onChange }) {
  return (
    <aside className="h-full overflow-y-auto p-6 space-y-7" data-testid="sidebar">
      <div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3 flex items-center gap-1.5">
          <Hash className="w-3 h-3" strokeWidth={1.5} /> Etiketler
        </div>
        <div className="space-y-0.5" data-testid="sidebar-tags-list">
          {tags.length === 0 && <p className="px-2 text-xs text-muted-foreground italic">Henüz etiket yok</p>}
          {tags.map((t) => (
            <EditableRow
              key={t.tag_id}
              icon={Hash}
              accentClass="text-[hsl(var(--accent-tag))]"
              label={t.name}
              to={`/tag/${encodeURIComponent(t.name)}`}
              onRename={async (n) => { await api.put(`/tags/${t.tag_id}`, { name: n }); onChange(); }}
              onDelete={async () => { await api.delete(`/tags/${t.tag_id}`); toast.success("Etiket silindi"); onChange(); }}
              testid={`tag-${t.name}`}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3 flex items-center gap-1.5">
          <AtSign className="w-3 h-3" strokeWidth={1.5} /> Kişiler
        </div>
        <div className="space-y-0.5" data-testid="sidebar-people-list">
          {people.length === 0 && <p className="px-2 text-xs text-muted-foreground italic">Henüz kişi yok</p>}
          {people.map((p) => (
            <EditableRow
              key={p.person_id}
              icon={AtSign}
              accentClass="text-[hsl(var(--accent-mention))]"
              label={p.name}
              to={`/person/${encodeURIComponent(p.name)}`}
              onRename={async (n) => { await api.put(`/people/${p.person_id}`, { name: n }); onChange(); }}
              onDelete={async () => { await api.delete(`/people/${p.person_id}`); toast.success("Kişi silindi"); onChange(); }}
              testid={`person-${p.name}`}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3 flex items-center gap-1.5">
          <MapPin className="w-3 h-3" strokeWidth={1.5} /> Konumlar
        </div>
        <div className="space-y-0.5" data-testid="sidebar-locations-list">
          {locations.length === 0 && <p className="px-2 text-xs text-muted-foreground italic">Henüz konum yok</p>}
          {locations.map((l) => (
            <EditableRow
              key={l.location_id}
              icon={MapPin}
              accentClass="text-muted-foreground"
              label={l.name}
              to={`/location/${l.location_id}`}
              onRename={async (n) => { await api.put(`/locations/${l.location_id}`, { name: n }); onChange(); }}
              onDelete={async () => { await api.delete(`/locations/${l.location_id}`); toast.success("Konum silindi"); onChange(); }}
              testid={`location-${l.name}`}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
