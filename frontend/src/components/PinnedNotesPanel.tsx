import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pin, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import type { Note } from "@/types";

interface Props {
  reloadKey: number;
}

export default function PinnedNotesPanel({ reloadKey }: Props) {
  const [pinned, setPinned] = useState<Note[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get<Note[]>("/notes", { params: { pinned: true } });
        if (mounted) setPinned(data || []);
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, [reloadKey]);

  if (pinned.length === 0) return null;

  return (
    <div className="border-b border-border" data-testid="pinned-notes-panel">
      <div className="px-6 pt-5 pb-2 flex items-center gap-1.5">
        <Pin className="w-3 h-3 text-[hsl(var(--accent-tag))]" strokeWidth={1.75} />
        <span className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">Sabitlenmiş</span>
      </div>
      <ul className="px-3 pb-3 space-y-1">
        {pinned.slice(0, 8).map((n) => {
          const preview = (n.title || n.content).replace(/```reminder[\s\S]*?```/g, "").replace(/[#>*`_-]/g, "").trim().slice(0, 60);
          return (
            <li key={n.note_id}>
              <Link
                to={`/note/${n.note_id}`}
                className="group flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
                data-testid={`pinned-item-${n.note_id}`}
              >
                <span className="flex-1 truncate font-serif text-sm leading-tight">{preview || "Başlıksız"}</span>
                <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={1.5} />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
