import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Network, Plus, Trash2 } from "lucide-react";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAreas } from "@/contexts/AreasContext";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import type { Area } from "@/types";

function AreaRow({ area, index, total, onMove }: { area: Area; index: number; total: number; onMove: (dir: -1 | 1) => void }) {
  const { reload } = useAreas();
  const [name, setName] = useState(area.name);
  const [description, setDescription] = useState(area.description || "");

  async function save(patch: Partial<Pick<Area, "name" | "color" | "description">>) {
    try {
      await api.put(`/areas/${area.area_id}`, patch);
      await reload();
    } catch (err) {
      toast.error(formatApiError(err));
      setName(area.name);
    }
  }

  async function remove() {
    try {
      await api.delete(`/areas/${area.area_id}`);
      await reload();
      toast.success("Alan silindi");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  return (
    <li className="border border-border rounded-md p-4 bg-card" data-testid={`settings-area-${area.area_id}`}>
      <div className="flex items-center gap-3">
        <label className="relative w-8 h-8 rounded-full shrink-0 cursor-pointer ring-1 ring-border" style={{ background: area.color }} title="Renk seç">
          <input
            type="color"
            value={area.color}
            onChange={(e) => save({ color: e.target.value })}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label={`${area.name} rengi`}
          />
        </label>
        <Input
          value={name}
          onChange={(e: any) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== area.name && save({ name: name.trim() })}
          onKeyDown={(e: any) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="font-serif text-lg h-9"
          data-testid={`settings-area-name-${area.area_id}`}
        />
        <Link
          to={`/area/${area.area_id}`}
          className="font-mono text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
        >
          {area.note_count} not
        </Link>
        <div className="flex items-center">
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Yukarı taşı">
            <ArrowUp className="w-3.5 h-3.5" strokeWidth={1.5} />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Aşağı taşı">
            <ArrowDown className="w-3.5 h-3.5" strokeWidth={1.5} />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label="Sil" data-testid={`settings-area-delete-${area.area_id}`}>
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-border rounded-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-serif">&quot;{area.name}&quot; silinsin mi?</AlertDialogTitle>
                <AlertDialogDescription>
                  Notlarınız silinmez; yalnızca bu alanla ilişkileri kaldırılır ({area.note_count} not).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>İptal</AlertDialogCancel>
                <AlertDialogAction onClick={remove} className="bg-destructive">Sil</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <Input
        value={description}
        onChange={(e: any) => setDescription(e.target.value)}
        onBlur={() => description !== (area.description || "") && save({ description })}
        placeholder="Kısa açıklama (opsiyonel)"
        className="mt-2 text-sm h-8 border-dashed"
      />
    </li>
  );
}

export default function Settings() {
  const { areas, reload } = useAreas();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api.post("/areas", { name: newName.trim() });
      setNewName("");
      await reload();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const order = [...areas];
    const j = index + dir;
    [order[index], order[j]] = [order[j], order[index]];
    try {
      await Promise.all(order.map((a, i) => (a.position !== i ? api.put(`/areas/${a.area_id}`, { position: i }) : null)));
    } finally {
      await reload();
    }
  }

  return (
    <div className="min-h-screen flex flex-col paper">
      <TopBar />
      <main className="max-w-2xl w-full mx-auto px-5 py-8" data-testid="settings-page">
        <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.5} /> Günceye dön
        </Link>
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-2">Ayarlar</div>
        <h1 className="font-serif text-4xl tracking-tight mb-2">Kişisel alanlar</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-prose">
          Hayatınızın alanlarını tanımlayın (ör. İş, Aile, Sağlık, Öğrenme). Not yazarken notu bir veya birden
          fazla alanla ilişkilendirebilirsiniz; graph görünümünde alanlar merkezde, not sayılarına göre büyüklükte
          gösterilir.
        </p>

        <form onSubmit={add} className="flex gap-2 mb-6">
          <Input
            value={newName}
            onChange={(e: any) => setNewName(e.target.value)}
            placeholder="Yeni alan adı"
            maxLength={60}
            data-testid="settings-new-area-input"
          />
          <Button type="submit" disabled={busy || !newName.trim()} className="rounded-sm" data-testid="settings-new-area-btn">
            <Plus className="w-4 h-4 mr-1" strokeWidth={1.5} /> Ekle
          </Button>
        </form>

        {areas.length === 0 ? (
          <p className="text-muted-foreground font-serif text-lg py-8 text-center">Henüz alan yok.</p>
        ) : (
          <ul className="space-y-3">
            {areas.map((a, i) => (
              <AreaRow key={a.area_id} area={a} index={i} total={areas.length} onMove={(dir) => move(i, dir)} />
            ))}
          </ul>
        )}

        {areas.length > 0 && (
          <Link to="/graph" className="inline-flex items-center gap-1.5 mt-8 text-sm text-muted-foreground hover:text-foreground">
            <Network className="w-4 h-4" strokeWidth={1.5} /> Graph'ta görüntüle
          </Link>
        )}
      </main>
    </div>
  );
}
