import React, { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";
import type { Tag, Person } from "@/types";

type SuggestionItem = Tag | Person;

interface PopupState {
  type: "tag" | "person";
  items: SuggestionItem[];
  start: number;
  query: string;
  selected: number;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
}

export default function MarkdownEditor({ value, onChange, placeholder, autoFocus, onSubmit, onCancel }: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [popup, setPopup] = useState<PopupState | null>(null);

  async function fetchSuggestions(type: "tag" | "person", query: string): Promise<SuggestionItem[]> {
    const url = type === "tag" ? "/tags" : "/people";
    const { data } = await api.get<SuggestionItem[]>(url, { params: { q: query } });
    return data || [];
  }

  function getActiveToken(text: string, caret: number): { type: "tag" | "person"; start: number; query: string } | null {
    let i = caret - 1;
    const chars: string[] = [];
    while (i >= 0) {
      const ch = text[i];
      if (ch === " " || ch === "\n" || ch === "\t") break;
      if (ch === "#" || ch === "@") {
        return { type: ch === "#" ? "tag" : "person", start: i, query: chars.reverse().join("") };
      }
      chars.push(ch);
      i--;
    }
    return null;
  }

  async function onChangeTextarea(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    onChange(text);
    const el = e.target;
    const caret = el.selectionStart;
    const token = getActiveToken(text, caret);
    if (token) {
      const items = await fetchSuggestions(token.type, token.query);
      setPopup({ ...token, items, selected: 0 });
    } else {
      setPopup(null);
    }
  }

  function applySuggestion(name: string) {
    if (!popup || !ref.current) return;
    const el = ref.current;
    const text = el.value;
    const caret = el.selectionStart;
    const before = text.slice(0, popup.start);
    const after = text.slice(caret);
    const symbol = popup.type === "tag" ? "#" : "@";
    const inserted = `${symbol}${name} `;
    const newText = before + inserted + after;
    onChange(newText);
    setPopup(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + inserted).length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (popup && popup.items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPopup({ ...popup, selected: (popup.selected + 1) % popup.items.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPopup({ ...popup, selected: (popup.selected - 1 + popup.items.length) % popup.items.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const item = popup.items[popup.selected];
        if (item) {
          e.preventDefault();
          applySuggestion(item.name);
          return;
        }
      }
      if (e.key === "Escape") {
        setPopup(null);
        return;
      }
    }
    if (popup && popup.items.length === 0 && (e.key === "Enter" || e.key === "Escape")) {
      setPopup(null);
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === "Escape" && !popup && onCancel) {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        data-testid="note-editor-input"
        value={value}
        onChange={onChangeTextarea}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="min-h-[140px] resize-y border-border bg-card focus-visible:ring-1 focus-visible:ring-foreground/30 font-mono text-sm leading-relaxed rounded-sm"
      />
      {popup && popup.items.length > 0 && (
        <div
          className="absolute z-50 mt-1 min-w-[200px] max-w-[280px] rounded-sm border border-border bg-popover/95 backdrop-blur-xl shadow-sm"
          style={{ top: "calc(100% + 2px)", left: 8 }}
          data-testid="autocomplete-popup"
        >
          <div className="px-3 py-1.5 text-[10px] tracking-[0.2em] uppercase text-muted-foreground border-b border-border">
            {popup.type === "tag" ? "Etiketler" : "Kişiler"}
          </div>
          <ul className="max-h-56 overflow-auto py-1">
            {popup.items.slice(0, 8).map((it, idx) => {
              const key = (it as Tag).tag_id ?? (it as Person).person_id;
              return (
                <li
                  key={key}
                  onMouseDown={(e) => { e.preventDefault(); applySuggestion(it.name); }}
                  className={`px-3 py-1.5 cursor-pointer text-sm font-mono flex items-center gap-2 ${idx === popup.selected ? "bg-accent" : ""}`}
                  data-testid={`autocomplete-item-${idx}`}
                >
                  <span className={popup.type === "tag" ? "text-[hsl(var(--accent-tag))]" : "text-[hsl(var(--accent-mention))]"}>
                    {popup.type === "tag" ? "#" : "@"}
                  </span>
                  {it.name}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
