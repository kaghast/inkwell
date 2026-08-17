import React, { ReactNode, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";
import { useFilter } from "@/contexts/FilterContext";
import api from "@/lib/api";
import { BellRing, MapPin, Youtube, Check } from "lucide-react";
import { isGmap, isYoutube, extractYoutubeId } from "@/lib/blocks";
import { toast } from "sonner";

const TAG_RE = /(^|\s)#([\w\-_ğüşıöçĞÜŞİÖÇ]+)/gu;
const MEN_RE = /(^|\s)@([\w\-_ğüşıöçĞÜŞİÖÇ]+)/gu;

function TagLink({ name }: { name: string }) {
  const { tryAddFilter } = useFilter();
  return (
    <Link
      to={`/tag/${encodeURIComponent(name)}`}
      className="inline-tag"
      onClick={(e) => { if (tryAddFilter("tag", name, e)) e.preventDefault(); }}
    >
      #{name}
    </Link>
  );
}

function MentionLink({ name }: { name: string }) {
  const { tryAddFilter } = useFilter();
  return (
    <Link
      to={`/person/${encodeURIComponent(name)}`}
      className="inline-mention"
      onClick={(e) => { if (tryAddFilter("person", name, e)) e.preventDefault(); }}
    >
      @{name}
    </Link>
  );
}

function transformChildren(children: ReactNode): ReactNode[] {
  const arr = Array.isArray(children) ? children : [children];
  const out: ReactNode[] = [];
  arr.forEach((child, idx) => {
    if (typeof child !== "string") {
      out.push(child);
      return;
    }
    let pieces: ReactNode[] = [child];
    pieces = pieces.flatMap((p, i) => {
      if (typeof p !== "string") return [p];
      const parts: ReactNode[] = [];
      let last = 0;
      const re = new RegExp(TAG_RE.source, "gu");
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) !== null) {
        if (m.index + m[1].length > last) parts.push(p.slice(last, m.index + m[1].length));
        const tagName = m[2].toLowerCase();
        parts.push(<TagLink key={`t-${idx}-${i}-${m.index}`} name={tagName} />);
        last = m.index + m[1].length + 1 + m[2].length;
      }
      if (last < p.length) parts.push(p.slice(last));
      return parts;
    });
    pieces = pieces.flatMap((p, i) => {
      if (typeof p !== "string") return [p];
      const parts: ReactNode[] = [];
      let last = 0;
      const re = new RegExp(MEN_RE.source, "gu");
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) !== null) {
        if (m.index + m[1].length > last) parts.push(p.slice(last, m.index + m[1].length));
        const name = m[2].toLowerCase();
        parts.push(<MentionLink key={`m-${idx}-${i}-${m.index}`} name={name} />);
        last = m.index + m[1].length + 1 + m[2].length;
      }
      if (last < p.length) parts.push(p.slice(last));
      return parts;
    });
    out.push(...pieces);
  });
  return out;
}

// -------- Special embeds --------

function YouTubeEmbed({ url }: { url: string }) {
  const id = extractYoutubeId(url);
  if (!id) return <a href={url} target="_blank" rel="noreferrer">{url}</a>;
  return (
    <div className="my-3 rounded-md overflow-hidden border border-border aspect-video bg-black" data-testid="yt-embed">
      <iframe
        src={`https://www.youtube.com/embed/${id}`}
        title="YouTube video"
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

function GmapEmbed({ url }: { url: string }) {
  const src = `https://maps.google.com/maps?q=${encodeURIComponent(url)}&output=embed`;
  return (
    <div className="my-3 rounded-md overflow-hidden border border-border" data-testid="gmap-embed">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-xs text-muted-foreground">
        <MapPin className="w-3 h-3" strokeWidth={1.5} />
        <a href={url} target="_blank" rel="noreferrer" className="truncate hover:text-foreground">{url}</a>
      </div>
      <iframe src={src} title="Google Map" className="w-full h-64 bg-muted" loading="lazy" />
    </div>
  );
}

function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return "şimdi";
  const s = Math.floor(msLeft / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}g ${h}sa ${m}dk`;
  if (h > 0) return `${h}sa ${m}dk`;
  if (m > 0) return `${m}dk ${sec}sn`;
  return `${sec}sn`;
}

function ReminderCard({ iso, text }: { iso: string; text: string }) {
  const target = new Date(iso).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const msLeft = target - now;
  const past = msLeft <= 0;
  const dtLabel = new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div
      className={`my-3 rounded-md border p-3 flex items-start gap-3 ${past ? "border-[hsl(var(--accent-tag))] bg-[hsl(var(--accent-tag)/0.08)]" : "border-border bg-muted/50"}`}
      data-testid="reminder-card"
    >
      <BellRing className={`w-4 h-4 mt-0.5 ${past ? "text-[hsl(var(--accent-tag))]" : "text-muted-foreground"}`} strokeWidth={1.75} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-serif leading-tight">{text || "Hatırlatma"}</div>
        <div className="text-[11px] font-mono text-muted-foreground mt-1">
          {dtLabel} · {past ? <span className="text-[hsl(var(--accent-tag))]">geldi</span> : <>kalan <span className="text-foreground">{fmtCountdown(msLeft)}</span></>}
        </div>
      </div>
    </div>
  );
}

function AuthImage({ src, alt }: { src?: string; alt?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url = "";
    let cancelled = false;
    (async () => {
      if (!src) return;
      // If absolute and NOT our /api/files, just use directly
      if (/^https?:\/\//i.test(src) && !src.includes("/api/files/")) {
        setBlobUrl(src);
        return;
      }
      // Otherwise fetch via authenticated api (may be relative "/api/files/...")
      try {
        const path = src.replace(/^.*\/api\//, "/").replace(/^\//, "");
        const res = await api.get(path, { responseType: "blob" });
        if (cancelled) return;
        url = URL.createObjectURL(res.data as any);
        setBlobUrl(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [src]);
  if (failed) return <span className="text-xs text-destructive">Resim yüklenemedi</span>;
  if (!blobUrl) return <span className="text-xs text-muted-foreground">Resim yükleniyor…</span>;
  return <img src={blobUrl} alt={alt || ""} className="rounded-md max-w-full h-auto border border-border" />;
}

// Custom paragraph: detect a raw YouTube/GMap URL alone inside → replace with embed
function ParagraphRenderer({ children }: { children: ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  // If single-child string that's a URL, no anchor was produced by react-markdown (bare URL treated as text)
  if (arr.length === 1) {
    const only = arr[0];
    if (typeof only === "string") {
      const s = only.trim();
      if (isYoutube(s)) return <YouTubeEmbed url={s} />;
      if (isGmap(s)) return <GmapEmbed url={s} />;
    }
    // Single anchor with URL as href → also detect
    if (React.isValidElement(only) && only.type === "a") {
      const href = (only.props as any).href as string;
      if (href && isYoutube(href)) return <YouTubeEmbed url={href} />;
      if (href && isGmap(href)) return <GmapEmbed url={href} />;
    }
  }
  return <p>{transformChildren(children)}</p>;
}

// Code fence: render `reminder\n<iso>\n<text>` fenced block as a card
function CodeRenderer(props: any) {
  const cls: string = props.className || "";
  const info = cls.replace(/^language-/, "").trim();
  const looksReminder = info === "reminder" || info.startsWith("reminder");
  if (looksReminder) {
    // Extract text from children (may be array of nodes)
    let raw = "";
    const walk = (c: any) => {
      if (typeof c === "string") raw += c;
      else if (Array.isArray(c)) c.forEach(walk);
      else if (React.isValidElement(c)) walk((c as any).props?.children);
    };
    walk(props.children);
    const lines = raw.replace(/\n$/, "").split("\n");
    const iso = (lines[0] || "").trim();
    const text = lines.slice(1).join("\n").trim();
    return <ReminderCard iso={iso} text={text} />;
  }
  return <code {...props} />;
}

interface Props {
  content: string;
  onTaskToggle?: (index: number, checked: boolean) => void;
}

export default function MarkdownView({ content, onTaskToggle }: Props) {
  // Track task index across the whole doc
  let taskCounter = { i: 0 };
  return (
    <div className="prose-paper" data-testid="markdown-view">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ParagraphRenderer as any,
          li: ({ children, ...rest }: any) => {
            // GFM task list: children starts with a checkbox input
            const first = Array.isArray(children) ? children[0] : children;
            if (React.isValidElement(first) && (first as any).props?.type === "checkbox") {
              const myIdx = taskCounter.i++;
              const checked = !!(first as any).props?.checked;
              return (
                <li className="flex items-start gap-2 list-none -ml-6" data-testid={`task-item-${myIdx}`}>
                  <button
                    type="button"
                    onClick={() => onTaskToggle?.(myIdx, !checked)}
                    className={`mt-1 w-4 h-4 rounded-sm border flex items-center justify-center transition-colors ${checked ? "bg-[hsl(var(--accent-tag))] border-[hsl(var(--accent-tag))]" : "border-border hover:border-foreground/40"}`}
                    data-testid={`task-toggle-${myIdx}`}
                    aria-label={checked ? "İşareti kaldır" : "İşaretle"}
                  >
                    {checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </button>
                  <span className={checked ? "line-through text-muted-foreground" : ""}>{transformChildren(Array.isArray(children) ? children.slice(1) : [])}</span>
                </li>
              );
            }
            return <li {...rest}>{transformChildren(children)}</li>;
          },
          h1: ({ children }: any) => <h1>{transformChildren(children)}</h1>,
          h2: ({ children }: any) => <h2>{transformChildren(children)}</h2>,
          h3: ({ children }: any) => <h3>{transformChildren(children)}</h3>,
          h4: ({ children }: any) => <h4>{transformChildren(children)}</h4>,
          h5: ({ children }: any) => <h5>{transformChildren(children)}</h5>,
          h6: ({ children }: any) => <h6>{transformChildren(children)}</h6>,
          img: ({ src, alt }: any) => <AuthImage src={src} alt={alt} />,
          pre: ({ children }: any) => {
            // Detect a fenced 'reminder' code block child and unwrap the <pre>
            const first = Array.isArray(children) ? children[0] : children;
            if (React.isValidElement(first)) {
              const cls: string = ((first as any).props?.className) || "";
              if (cls.startsWith("language-reminder") || cls === "language-reminder") {
                return <>{first}</>;
              }
            }
            return <pre>{children}</pre>;
          },
          code: CodeRenderer,
          a: ({ href, children }: any) => {
            if (href && isYoutube(href)) return <YouTubeEmbed url={href} />;
            if (href && isGmap(href)) return <GmapEmbed url={href} />;
            return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
          },
        }}
      >
        {content || ""}
      </ReactMarkdown>
    </div>
  );
}

// Simple hook: parses task lines from markdown and rewrites the checked state
export function toggleTaskInMarkdown(md: string, index: number, checked: boolean): string {
  const lines = md.split("\n");
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- \[([ xX])\](.*)$/);
    if (m) {
      if (count === index) {
        lines[i] = `${m[1]}- [${checked ? "x" : " "}]${m[3]}`;
        return lines.join("\n");
      }
      count++;
    }
  }
  return md;
}
