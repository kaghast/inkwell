import React, { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";
import type { Tag, Person } from "@/types";
import { BLOCK_OPTIONS, filterBlockOptions, BlockOption } from "@/lib/blockOptions";
import type { BlockType } from "@/lib/blocks";
import LinkDialog from "@/components/LinkDialog";
import ReminderDialog from "@/components/ReminderDialog";
import { uploadImage } from "@/lib/uploads";
import { toast } from "sonner";

type SuggestionItem = Tag | Person;

interface TokenPopup {
  kind: "tag" | "person";
  items: SuggestionItem[];
  start: number;
  query: string;
  selected: number;
}

interface SlashPopup {
  kind: "slash";
  start: number;      // index of '/'
  query: string;
  options: BlockOption[];
  selected: number;
}

type Popup = TokenPopup | SlashPopup;

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
  const [popup, setPopup] = useState<Popup | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [pendingBlock, setPendingBlock] = useState<null | { start: number; end: number }>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function fetchSuggestions(type: "tag" | "person", query: string): Promise<SuggestionItem[]> {
    const url = type === "tag" ? "/tags" : "/people";
    const { data } = await api.get<SuggestionItem[]>(url, { params: { q: query } });
    return data || [];
  }

  // Return either a token (#tag, @person) or a slash-command context
  function getActiveContext(text: string, caret: number): { type: "tag" | "person" | "slash"; start: number; query: string } | null {
    let i = caret - 1;
    const chars: string[] = [];
    while (i >= 0) {
      const ch = text[i];
      if (ch === " " || ch === "\n" || ch === "\t") break;
      if (ch === "#" || ch === "@") {
        return { type: ch === "#" ? "tag" : "person", start: i, query: chars.reverse().join("") };
      }
      if (ch === "/") {
        // ensure "/" is at start of line or after whitespace
        const prev = i > 0 ? text[i - 1] : "\n";
        if (prev === "\n" || prev === " " || prev === "\t" || i === 0) {
          return { type: "slash", start: i, query: chars.reverse().join("") };
        }
        break;
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
    const ctx = getActiveContext(text, caret);
    if (!ctx) { setPopup(null); return; }
    if (ctx.type === "slash") {
      setPopup({ kind: "slash", start: ctx.start, query: ctx.query, options: filterBlockOptions(ctx.query), selected: 0 });
      return;
    }
    const items = await fetchSuggestions(ctx.type, ctx.query);
    setPopup({ kind: ctx.type, items, start: ctx.start, query: ctx.query, selected: 0 });
  }

  function replaceRange(before: number, after: number, insert: string, extraSelectOffset?: number) {
    if (!ref.current) return;
    const el = ref.current;
    const text = el.value;
    const newText = text.slice(0, before) + insert + text.slice(after);
    onChange(newText);
    requestAnimationFrame(() => {
      el.focus();
      const pos = before + (extraSelectOffset ?? insert.length);
      el.setSelectionRange(pos, pos);
    });
  }

  function applyTokenSuggestion(name: string) {
    if (!popup || popup.kind === "slash" || !ref.current) return;
    const el = ref.current;
    const caret = el.selectionStart;
    const symbol = popup.kind === "tag" ? "#" : "@";
    const inserted = `${symbol}${name} `;
    replaceRange(popup.start, caret, inserted);
    setPopup(null);
  }

  function applyBlockOption(opt: BlockOption) {
    if (!popup || popup.kind !== "slash" || !ref.current) return;
    const el = ref.current;
    const caret = el.selectionStart;
    const from = popup.start;

    const insertPlain = (tpl: string, extraSelect?: number) => {
      // Ensure a newline before if not at start of a line
      const before = el.value.slice(0, from);
      const needsNl = before.length > 0 && !before.endsWith("\n") && !before.endsWith("\n\n");
      const prefix = needsNl ? "\n" : "";
      replaceRange(from, caret, prefix + tpl, prefix.length + (extraSelect ?? tpl.length));
    };

    switch (opt.type) {
      case "paragraph": insertPlain(""); break;
      case "heading1": insertPlain("# "); break;
      case "heading2": insertPlain("## "); break;
      case "heading3": insertPlain("### "); break;
      case "heading4": insertPlain("#### "); break;
      case "heading5": insertPlain("##### "); break;
      case "heading6": insertPlain("###### "); break;
      case "task": insertPlain("- [ ] "); break;
      case "quote": insertPlain("> "); break;
      case "divider": insertPlain("---\n\n"); break;
      case "link":
        setPendingBlock({ start: from, end: caret });
        setPopup(null);
        setLinkOpen(true);
        return;
      case "youtube":
      case "gmap":
        // Prompt for URL as a link — renderer will detect and embed
        setPendingBlock({ start: from, end: caret });
        setPopup(null);
        setLinkOpen(true);
        return;
      case "image":
        setPendingBlock({ start: from, end: caret });
        setPopup(null);
        fileInputRef.current?.click();
        return;
      case "reminder":
        setPendingBlock({ start: from, end: caret });
        setPopup(null);
        setReminderOpen(true);
        return;
    }
    setPopup(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (popup) {
      const listLen = popup.kind === "slash" ? popup.options.length : popup.items.length;
      if (listLen > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPopup({ ...popup, selected: (popup.selected + 1) % listLen } as Popup);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPopup({ ...popup, selected: (popup.selected - 1 + listLen) % listLen } as Popup);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          if (popup.kind === "slash") applyBlockOption(popup.options[popup.selected]);
          else applyTokenSuggestion((popup.items[popup.selected] as any).name);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPopup(null);
        return;
      }
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

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset
    if (!file || !pendingBlock) return;
    try {
      toast.loading("Yükleniyor…", { id: "upl" });
      const res = await uploadImage(file);
      toast.success("Yüklendi", { id: "upl" });
      const md = `![${file.name}](${res.url})`;
      const before = ref.current?.value.slice(0, pendingBlock.start) || "";
      const needsNl = before.length > 0 && !before.endsWith("\n");
      const prefix = needsNl ? "\n" : "";
      replaceRange(pendingBlock.start, pendingBlock.end, prefix + md + "\n");
    } catch (err) {
      toast.error("Yükleme başarısız", { id: "upl" });
    } finally {
      setPendingBlock(null);
    }
  }

  function onLinkConfirm(title: string, url: string) {
    if (!pendingBlock) return;
    const before = ref.current?.value.slice(0, pendingBlock.start) || "";
    const needsNl = before.length > 0 && !before.endsWith("\n");
    const prefix = needsNl ? "\n" : "";
    // For YouTube/GMap the markdown link is fine — renderer detects the URL.
    const md = `[${title}](${url})`;
    replaceRange(pendingBlock.start, pendingBlock.end, prefix + md + "\n");
    setPendingBlock(null);
  }

  function onReminderConfirm(iso: string, text: string) {
    if (!pendingBlock) return;
    const before = ref.current?.value.slice(0, pendingBlock.start) || "";
    const needsNl = before.length > 0 && !before.endsWith("\n");
    const prefix = needsNl ? "\n" : "";
    const md = "```reminder\n" + iso + "\n" + text + "\n```";
    replaceRange(pendingBlock.start, pendingBlock.end, prefix + md + "\n");
    setPendingBlock(null);
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
        placeholder={placeholder || "Yazın… ‘/’ ile blok tipi seçebilirsiniz"}
        className="min-h-[160px] resize-y border-border bg-card focus-visible:ring-1 focus-visible:ring-foreground/30 font-mono text-sm leading-relaxed rounded-md"
      />

      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={onFileSelected}
        style={{ display: "none" }}
        data-testid="image-upload-input"
      />

      {/* Slash / token popup */}
      {popup && (popup.kind === "slash" ? popup.options.length > 0 : popup.items.length > 0) && (
        <div
          className="absolute z-50 min-w-[240px] max-w-[320px] rounded-md border border-border bg-popover/98 backdrop-blur-xl shadow-lg"
          style={{ top: "calc(100% + 4px)", left: 8 }}
          data-testid={popup.kind === "slash" ? "block-picker-popup" : "autocomplete-popup"}
        >
          <div className="px-3 py-1.5 text-[10px] tracking-[0.2em] uppercase text-muted-foreground border-b border-border">
            {popup.kind === "slash" ? "Blok tipi" : popup.kind === "tag" ? "Etiketler" : "Kişiler"}
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {popup.kind === "slash"
              ? popup.options.slice(0, 10).map((opt, idx) => {
                  const Icon = opt.icon;
                  return (
                    <li
                      key={opt.type}
                      onMouseDown={(e) => { e.preventDefault(); applyBlockOption(opt); }}
                      className={`px-3 py-1.5 cursor-pointer text-sm flex items-center gap-2.5 ${idx === popup.selected ? "bg-accent" : ""}`}
                      data-testid={`block-picker-item-${opt.type}`}
                    >
                      <Icon className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                      <div className="flex-1 min-w-0">
                        <div className="font-serif leading-none">{opt.label}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{opt.hint}</div>
                      </div>
                    </li>
                  );
                })
              : (popup.items as SuggestionItem[]).slice(0, 8).map((it, idx) => (
                  <li
                    key={(it as any).tag_id || (it as any).person_id}
                    onMouseDown={(e) => { e.preventDefault(); applyTokenSuggestion(it.name); }}
                    className={`px-3 py-1.5 cursor-pointer text-sm font-mono flex items-center gap-2 ${idx === popup.selected ? "bg-accent" : ""}`}
                    data-testid={`autocomplete-item-${idx}`}
                  >
                    <span className={popup.kind === "tag" ? "text-[hsl(var(--accent-tag))]" : "text-[hsl(var(--accent-mention))]"}>
                      {popup.kind === "tag" ? "#" : "@"}
                    </span>
                    {it.name}
                  </li>
                ))}
          </ul>
        </div>
      )}

      <LinkDialog open={linkOpen} onOpenChange={setLinkOpen} onConfirm={onLinkConfirm} />
      <ReminderDialog open={reminderOpen} onOpenChange={setReminderOpen} onConfirm={onReminderConfirm} />
    </div>
  );
}
