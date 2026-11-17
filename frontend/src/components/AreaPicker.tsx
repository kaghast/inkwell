import React from "react";
import { Link } from "react-router-dom";
import { Check, Settings2 } from "lucide-react";
import { useAreas } from "@/contexts/AreasContext";

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  compact?: boolean;
}

/** Toggle chips for linking a note to one or more personal areas. */
export default function AreaPicker({ value, onChange, compact }: Props) {
  const { areas } = useAreas();

  if (areas.length === 0) {
    return (
      <Link
        to="/settings"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        data-testid="area-picker-empty"
      >
        <Settings2 className="w-3.5 h-3.5" strokeWidth={1.5} /> Ayarlar'dan kişisel alan ekleyin
      </Link>
    );
  }

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? "" : "py-0.5"}`} data-testid="area-picker">
      {areas.map((a) => {
        const on = value.includes(a.area_id);
        return (
          <button
            key={a.area_id}
            type="button"
            onClick={() => toggle(a.area_id)}
            aria-pressed={on}
            data-testid={`area-chip-${a.area_id}`}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors"
            style={
              on
                ? { borderColor: a.color, background: `${a.color}22`, color: "hsl(var(--foreground))" }
                : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }
            }
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.color }} />
            {a.name}
            {on && <Check className="w-3 h-3" strokeWidth={2} />}
          </button>
        );
      })}
    </div>
  );
}

/** Read-only coloured chips for the areas a note belongs to. */
export function AreaBadges({ ids }: { ids?: string[] }) {
  const { areaMap } = useAreas();
  const list = (ids || []).map((id) => areaMap[id]).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <>
      {list.map((a) => (
        <Link
          key={a.area_id}
          to={`/area/${a.area_id}`}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] border"
          style={{ borderColor: `${a.color}66`, background: `${a.color}14` }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />
          {a.name}
        </Link>
      ))}
    </>
  );
}
