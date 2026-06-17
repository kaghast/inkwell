import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, X, Hash, AtSign, MapPin } from "lucide-react";
import type { FilterType } from "@/contexts/FilterContext";

export interface FilterChip {
  type: FilterType;
  value: string;
  label: string;
  locked?: boolean; // when this chip comes from the route (cannot be removed without navigation)
}

interface Props {
  q: string;
  onQChange: (v: string) => void;
  chips: FilterChip[];
  onRemoveChip: (chip: FilterChip) => void;
  placeholder?: string;
}

export default function SearchBar({ q, onQChange, chips, onRemoveChip, placeholder }: Props) {
  // Debounced local value to avoid spamming the server on each keystroke.
  const [local, setLocal] = useState(q);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => { setLocal(q); }, [q]);

  function onLocalChange(v: string) {
    setLocal(v);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => onQChange(v), 220);
  }

  return (
    <div className="mb-5" data-testid="search-bar">
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
          strokeWidth={1.75}
        />
        <Input
          value={local}
          onChange={(e: any) => onLocalChange(e.target.value)}
          placeholder={placeholder || "Notlarda ara… (Ctrl+tıkla → çoklu filtre)"}
          data-testid="search-input"
          className="pl-10 pr-9 h-11 rounded-lg bg-card border-border focus-visible:ring-1 focus-visible:ring-foreground/30 text-sm"
        />
        {local && (
          <button
            onClick={() => { setLocal(""); onQChange(""); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            data-testid="search-clear-btn"
            aria-label="Temizle"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3" data-testid="filter-chips">
          {chips.map((c, idx) => {
            const Icon = c.type === "tag" ? Hash : c.type === "person" ? AtSign : MapPin;
            const accent =
              c.type === "tag"
                ? "bg-[hsl(var(--accent-tag)/0.14)] text-[hsl(var(--accent-tag))] border-[hsl(var(--accent-tag)/0.25)]"
                : c.type === "person"
                ? "bg-[hsl(var(--accent-mention)/0.14)] text-[hsl(var(--accent-mention))] border-[hsl(var(--accent-mention)/0.25)]"
                : "bg-muted text-foreground border-border";
            return (
              <span
                key={`${c.type}-${c.value}-${idx}`}
                className={`inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full border text-xs font-mono ${accent}`}
                data-testid={`chip-${c.type}-${c.value}`}
              >
                <Icon className="w-3 h-3" strokeWidth={1.75} />
                {c.label}
                {!c.locked && (
                  <button
                    onClick={() => onRemoveChip(c)}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-foreground/10"
                    data-testid={`chip-remove-${c.type}-${c.value}`}
                    aria-label="Filtreyi kaldır"
                  >
                    <X className="w-3 h-3" strokeWidth={2} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
