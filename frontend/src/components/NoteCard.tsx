import React from "react";
import { Link } from "react-router-dom";
import { MapPin, Calendar as CalIcon, Trash2 } from "lucide-react";
import MarkdownView from "@/components/MarkdownView";
import { Button } from "@/components/ui/button";
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

interface Props {
  note: Note;
  locationMap: Record<string, LocationItem>;
  onDelete: (id: string) => void;
}

export default function NoteCard({ note, locationMap, onDelete }: Props) {
  const loc = note.location_id ? locationMap[note.location_id] : null;
  return (
    <article className="border-b border-border py-7 first:pt-2" data-testid={`note-card-${note.note_id}`}>
      <header className="flex items-baseline justify-between mb-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
          <span className="flex items-center gap-1"><CalIcon className="w-3 h-3" strokeWidth={1.5} />{formatDate(note.date)}</span>
          <span>·</span>
          <span>{formatTime(note.created_at)}</span>
          {loc && (
            <>
              <span>·</span>
              <Link to={`/location/${loc.location_id}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
                <MapPin className="w-3 h-3" strokeWidth={1.5} />{loc.name}
              </Link>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Link to={`/note/${note.note_id}`} className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground hover:text-foreground" data-testid={`note-open-${note.note_id}`}>Aç →</Link>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" data-testid={`note-delete-${note.note_id}`}>
                <Trash2 className="w-3.5 h-3.5" strokeWidth={1.25} />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-border rounded-sm">
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
      {note.title && (
        <h2 className="font-serif text-2xl mb-2 leading-tight">
          <Link to={`/note/${note.note_id}`} className="hover:text-[hsl(var(--accent-tag))] transition-colors">
            {note.title}
          </Link>
        </h2>
      )}
      <MarkdownView content={note.content} />
    </article>
  );
}
