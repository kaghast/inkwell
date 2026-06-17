import React, { useState, ComponentType, MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Hash, AtSign, MapPin, Pencil, Trash2, X, Check } from "lucide-react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { Tag, Person, LocationItem } from "@/types";
import { useFilter } from "@/contexts/FilterContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type RowFilterType = "tag" | "person" | "location";

interface EditableRowProps {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  to: string;
  filterType: RowFilterType;
  filterValue: string;
  onRename: (newName: string) => Promise<void>;
  onDelete: () => Promise<void>;
  accentClass: string;
  testid: string;
}

function EditableRow({ icon: Icon, label, to, filterType, filterValue, onRename, onDelete, accentClass, testid }: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(label);
  const nav = useNavigate();
  const { tryAddFilter } = useFilter();

  async function save() {
    const trimmed = val.trim();
    if (!trimmed || trimmed === label) { setEditing(false); setVal(label); return; }
    try {
      await onRename(trimmed);
      toast.success("Güncellendi");
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Hata");
    }
  }

  function onClickRow(e: ReactMouseEvent) {
    if (tryAddFilter(filterType, filterValue, e)) return; // ctrl+click → add filter
    nav(to);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 px-2 py-1" data-testid={`${testid}-edit-row`}>
        <Icon className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.5} />
        <Input
          value={val}
          autoFocus
          onChange={(e: any) => setVal(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setVal(label); } }}
          className="h-7 text-sm font-mono rounded-md"
        />
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={save}><Check className="w-3.5 h-3.5" /></Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(false); setVal(label); }}><X className="w-3.5 h-3.5" /></Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between px-2 py-1 rounded-md hover:bg-accent/50 transition-colors" data-testid={`${testid}-row`}>
      <button
        className="flex items-center gap-1.5 text-sm font-mono truncate text-left flex-1"
        onClick={onClickRow}
        title="Tıkla: tek filtre · Ctrl/Cmd+tıkla: filtreye ekle"
      >
        <Icon className={`w-3.5 h-3.5 ${accentClass}`} strokeWidth={1.5} />
        <span className="truncate">{label}</span>
      </button>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(true)} data-testid={`${testid}-edit-btn`}>
          <Pencil className="w-3 h-3" strokeWidth={1.5} />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" data-testid={`${testid}-delete-btn`}>
              <Trash2 className="w-3 h-3" strokeWidth={1.5} />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-card border-border rounded-md">
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

interface SidebarProps {
  tags: Tag[];
  people: Person[];
  locations: LocationItem[];
  onChange: () => void;
}

export default function Sidebar({ tags, people, locations, onChange }: SidebarProps) {
  return (
    <aside className="h-full overflow-y-auto p-5" data-testid="sidebar">
      <Tabs defaultValue="tags" className="w-full">
        <TabsList className="grid grid-cols-3 mb-5 bg-secondary rounded-lg w-full" data-testid="sidebar-tabs">
          <TabsTrigger value="tags" data-testid="sidebar-tab-tags" className="text-xs tracking-wide rounded-md">
            <Hash className="w-3 h-3 mr-1" strokeWidth={1.75} /> Etiket
          </TabsTrigger>
          <TabsTrigger value="people" data-testid="sidebar-tab-people" className="text-xs tracking-wide rounded-md">
            <AtSign className="w-3 h-3 mr-1" strokeWidth={1.75} /> Kişi
          </TabsTrigger>
          <TabsTrigger value="locations" data-testid="sidebar-tab-locations" className="text-xs tracking-wide rounded-md">
            <MapPin className="w-3 h-3 mr-1" strokeWidth={1.75} /> Konum
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tags" className="mt-2">
          <div className="space-y-0.5" data-testid="sidebar-tags-list">
            {tags.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Henüz etiket yok</p>}
            {tags.map((t) => (
              <EditableRow
                key={t.tag_id}
                icon={Hash}
                accentClass="text-[hsl(var(--accent-tag))]"
                label={t.name}
                to={`/tag/${encodeURIComponent(t.name)}`}
                filterType="tag"
                filterValue={t.name}
                onRename={async (n) => { await api.put(`/tags/${t.tag_id}`, { name: n }); onChange(); }}
                onDelete={async () => { await api.delete(`/tags/${t.tag_id}`); toast.success("Etiket silindi"); onChange(); }}
                testid={`tag-${t.name}`}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="people" className="mt-2">
          <div className="space-y-0.5" data-testid="sidebar-people-list">
            {people.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Henüz kişi yok</p>}
            {people.map((p) => (
              <EditableRow
                key={p.person_id}
                icon={AtSign}
                accentClass="text-[hsl(var(--accent-mention))]"
                label={p.name}
                to={`/person/${encodeURIComponent(p.name)}`}
                filterType="person"
                filterValue={p.name}
                onRename={async (n) => { await api.put(`/people/${p.person_id}`, { name: n }); onChange(); }}
                onDelete={async () => { await api.delete(`/people/${p.person_id}`); toast.success("Kişi silindi"); onChange(); }}
                testid={`person-${p.name}`}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="locations" className="mt-2">
          <div className="space-y-0.5" data-testid="sidebar-locations-list">
            {locations.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Henüz konum yok</p>}
            {locations.map((l) => (
              <EditableRow
                key={l.location_id}
                icon={MapPin}
                accentClass="text-muted-foreground"
                label={l.name}
                to={`/location/${l.location_id}`}
                filterType="location"
                filterValue={l.location_id}
                onRename={async (n) => { await api.put(`/locations/${l.location_id}`, { name: n }); onChange(); }}
                onDelete={async () => { await api.delete(`/locations/${l.location_id}`); toast.success("Konum silindi"); onChange(); }}
                testid={`location-${l.name}`}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
