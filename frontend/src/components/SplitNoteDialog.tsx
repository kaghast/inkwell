import React, { useEffect, useMemo, useState } from "react";
import { Scissors } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import type { Note } from "@/types";

interface Props {
  note: Note;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSplit: () => void;
}

/**
 * Shows the note's lines; the user clicks a gap between two lines to place the cut.
 * Lines [0, cut) stay in this note, lines [cut, …) become a new note.
 */
export default function SplitNoteDialog({ note, open, onOpenChange, onSplit }: Props) {
  const lines = useMemo(() => (note.content || "").replace(/\r\n/g, "\n").split("\n"), [note.content]);
  const [cut, setCut] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setCut(null); }, [open]);

  // A gap before line i is a valid cut if it's not inside a ``` fence and both sides have text.
  const validCuts = useMemo(() => {
    const ok = new Set<number>();
    let inFence = false;
    const hasTextBefore: boolean[] = [];
    let seen = false;
    for (let i = 0; i < lines.length; i++) {
      hasTextBefore[i] = seen;
      if (lines[i].trim()) seen = true;
    }
    let textAfter = false;
    const hasTextFrom: boolean[] = new Array(lines.length).fill(false);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) textAfter = true;
      hasTextFrom[i] = textAfter;
    }
    for (let i = 0; i < lines.length; i++) {
      if (i > 0 && !inFence && hasTextBefore[i] && hasTextFrom[i]) ok.add(i);
      if (lines[i].trim().startsWith("```")) inFence = !inFence;
    }
    return ok;
  }, [lines]);

  async function doSplit() {
    if (cut == null) return;
    setBusy(true);
    try {
      await api.post(`/notes/${note.note_id}/split`, { at_line: cut });
      toast.success("Not ikiye bölündü");
      onOpenChange(false);
      onSplit();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card border-border" data-testid={`split-dialog-${note.note_id}`}>
        <DialogHeader>
          <DialogTitle className="font-serif">Notu böl</DialogTitle>
          <DialogDescription>
            İki satır arasına tıklayarak kesme noktasını seç. Üstteki kısım bu notta kalır, alttaki kısım yeni bir not olur.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-secondary/40 py-2 font-mono text-sm">
          {lines.map((line, i) => {
            const canCut = validCuts.has(i);
            const selected = cut === i;
            const below = cut != null && i >= cut;
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  canCut ? (
                    <button
                      type="button"
                      onClick={() => setCut(selected ? null : i)}
                      className={`group relative block w-full h-3 ${selected ? "my-1" : ""}`}
                      aria-label={`${i}. satırdan sonra kes`}
                      data-testid={`split-gap-${i}`}
                    >
                      <span
                        className={`absolute inset-x-2 top-1/2 -translate-y-1/2 border-t-2 border-dashed transition-opacity ${
                          selected
                            ? "border-[hsl(var(--accent-tag))] opacity-100"
                            : "border-muted-foreground/50 opacity-0 group-hover:opacity-100"
                        }`}
                      />
                      <Scissors
                        className={`absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 transition-opacity ${
                          selected ? "text-[hsl(var(--accent-tag))] opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100"
                        }`}
                      />
                    </button>
                  ) : (
                    <div className="h-3" />
                  )
                )}
                <div className={`px-5 whitespace-pre-wrap break-words min-h-[1.25rem] ${below ? "text-muted-foreground" : ""}`}>
                  {line || " "}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button
            onClick={doSplit}
            disabled={cut == null || busy}
            className="bg-foreground text-background hover:bg-foreground/90 rounded-md"
            data-testid={`split-confirm-${note.note_id}`}
          >
            <Scissors className="w-3.5 h-3.5 mr-1.5" /> {busy ? "Bölünüyor…" : "Böl"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
