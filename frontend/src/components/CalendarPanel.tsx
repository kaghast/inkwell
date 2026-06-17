import React, { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarCounts } from "@/types";

function getMonthGrid(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const MONTHS = [
  "Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"
];

interface Props {
  year: number;
  month: number; // 1-12
  onChangeMonth: (delta: number) => void;
  counts: CalendarCounts;
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
}

export default function CalendarPanel({ year, month, onChangeMonth, counts, selectedDate, onSelectDate }: Props) {
  const cells = useMemo(() => getMonthGrid(year, month - 1), [year, month]);
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const fmtCellDate = (d: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return (
    <aside className="h-full overflow-y-auto p-6 space-y-4" data-testid="calendar-panel">
      <div className="flex items-center justify-between">
        <Button size="icon" variant="ghost" onClick={() => onChangeMonth(-1)} data-testid="cal-prev-btn" className="h-7 w-7">
          <ChevronLeft className="w-4 h-4" strokeWidth={1.25} />
        </Button>
        <div className="text-center">
          <div className="font-serif text-xl leading-none" data-testid="cal-title">{MONTHS[month - 1]}</div>
          <div className="text-xs text-muted-foreground font-mono mt-1">{year}</div>
        </div>
        <Button size="icon" variant="ghost" onClick={() => onChangeMonth(1)} data-testid="cal-next-btn" className="h-7 w-7">
          <ChevronRight className="w-4 h-4" strokeWidth={1.25} />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[10px] tracking-[0.15em] uppercase text-muted-foreground py-1">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = fmtCellDate(d);
          const count = counts[iso] || 0;
          const isToday = iso === todayIso;
          const isSelected = iso === selectedDate;
          return (
            <button
              key={i}
              onClick={() => onSelectDate(iso)}
              data-testid={`cal-day-${iso}`}
              className={`relative aspect-square flex items-center justify-center font-mono text-sm rounded-sm border transition-colors
                ${isSelected ? "border-foreground bg-foreground text-background" : "border-transparent hover:border-border hover:bg-accent/40"}
                ${isToday && !isSelected ? "ring-1 ring-[hsl(var(--accent-tag))] ring-inset" : ""}
              `}
            >
              {d}
              {count > 0 && (
                <span
                  className={`absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-1 flex items-center justify-center text-[9px] font-serif italic rounded-full
                    ${isSelected ? "bg-background text-foreground" : "bg-[hsl(var(--accent-tag))] text-white"}`}
                  data-testid={`cal-badge-${iso}`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="pt-4 mt-4 border-t border-border text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>Bugün</span>
          <button
            className="font-mono text-xs text-foreground hover:underline"
            onClick={() => onSelectDate(todayIso)}
            data-testid="cal-today-btn"
          >
            Bugüne dön
          </button>
        </div>
      </div>
    </aside>
  );
}
