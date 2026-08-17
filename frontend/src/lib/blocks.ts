// Block model + markdown serializer/deserializer
export type BlockType =
  | "paragraph"
  | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6"
  | "task"
  | "divider"
  | "quote"
  | "link"
  | "image"
  | "youtube"
  | "gmap"
  | "reminder";

export interface BaseBlock {
  id: string;
  type: BlockType;
  text: string;
  // per-type extras stored as loose fields
  checked?: boolean;    // task
  url?: string;         // link/image/youtube/gmap
  meta?: any;           // link preview metadata (title, description, image)
  fileId?: string;      // image blocks pointing to /api/files/:file_id
  remindAt?: string;    // ISO datetime — reminder
  reminderId?: string;
}

export function newId(): string {
  return "b_" + Math.random().toString(36).slice(2, 10);
}

export function emptyParagraph(): BaseBlock {
  return { id: newId(), type: "paragraph", text: "" };
}

// ---------- Serialize blocks → markdown ----------
export function blocksToMarkdown(blocks: BaseBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading1": parts.push(`# ${b.text}`); break;
      case "heading2": parts.push(`## ${b.text}`); break;
      case "heading3": parts.push(`### ${b.text}`); break;
      case "heading4": parts.push(`#### ${b.text}`); break;
      case "heading5": parts.push(`##### ${b.text}`); break;
      case "heading6": parts.push(`###### ${b.text}`); break;
      case "task":     parts.push(`- [${b.checked ? "x" : " "}] ${b.text}`); break;
      case "divider":  parts.push("---"); break;
      case "quote":    parts.push(`> ${b.text.replace(/\n/g, "\n> ")}`); break;
      case "link": {
        const title = b.text?.trim() || b.url || "link";
        parts.push(`[${title}](${b.url || ""})`);
        break;
      }
      case "image": {
        parts.push(`![${b.text || ""}](${b.url || ""})`);
        break;
      }
      case "youtube": {
        // preserve as raw URL on its own line for renderer to detect + embed
        parts.push(b.url || "");
        break;
      }
      case "gmap": {
        parts.push(b.url || "");
        break;
      }
      case "reminder": {
        const iso = b.remindAt || "";
        parts.push("```reminder\n" + iso + "\n" + (b.text || "") + "\n```");
        break;
      }
      case "paragraph":
      default:
        parts.push(b.text || "");
    }
  }
  return parts.join("\n\n").trim();
}

// ---------- Parse markdown → blocks (best effort) ----------
const YOUTUBE_RE = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[?&][^\s]*)?$/i;
const GMAP_RE = /^https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\/\S+$/i;
const IMAGE_ONLY_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const LINK_ONLY_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;
const TASK_RE = /^- \[([ xX])\] (.*)$/;
const HEADING_RE = /^(#{1,6}) (.*)$/;
const QUOTE_RE = /^> ?(.*)$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const REMINDER_FENCE_START = /^```reminder\s*$/i;

export function markdownToBlocks(md: string): BaseBlock[] {
  const src = (md || "").replace(/\r\n/g, "\n").trim();
  if (!src) return [];
  const lines = src.split("\n");
  const blocks: BaseBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // reminder fenced block: first content line is ISO, rest is text
    if (REMINDER_FENCE_START.test(line)) {
      i++;
      const iso = i < lines.length ? lines[i].trim() : "";
      i++;
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() !== "```") {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        id: newId(),
        type: "reminder",
        text: buf.join("\n").trim(),
        remindAt: iso,
      });
      continue;
    }
    if (!line.trim()) { i++; continue; }
    if (HR_RE.test(line.trim())) {
      blocks.push({ id: newId(), type: "divider", text: "" });
      i++; continue;
    }
    const tm = line.match(TASK_RE);
    if (tm) {
      blocks.push({ id: newId(), type: "task", text: tm[2], checked: tm[1].toLowerCase() === "x" });
      i++; continue;
    }
    const hm = line.match(HEADING_RE);
    if (hm) {
      const lvl = hm[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ id: newId(), type: `heading${lvl}` as BlockType, text: hm[2] });
      i++; continue;
    }
    const qm = line.match(QUOTE_RE);
    if (qm) {
      // collect consecutive quote lines
      const buf: string[] = [qm[1]];
      i++;
      while (i < lines.length) {
        const qm2 = lines[i].match(QUOTE_RE);
        if (qm2) { buf.push(qm2[1]); i++; } else break;
      }
      blocks.push({ id: newId(), type: "quote", text: buf.join("\n") });
      continue;
    }
    const im = line.match(IMAGE_ONLY_RE);
    if (im) {
      blocks.push({ id: newId(), type: "image", text: im[1], url: im[2] });
      i++; continue;
    }
    const lm = line.match(LINK_ONLY_RE);
    if (lm) {
      const url = lm[2];
      if (YOUTUBE_RE.test(url)) {
        blocks.push({ id: newId(), type: "youtube", text: lm[1], url });
      } else if (GMAP_RE.test(url)) {
        blocks.push({ id: newId(), type: "gmap", text: lm[1], url });
      } else {
        blocks.push({ id: newId(), type: "link", text: lm[1], url });
      }
      i++; continue;
    }
    // raw URL on own line
    if (/^https?:\/\/\S+$/.test(line.trim())) {
      const url = line.trim();
      if (YOUTUBE_RE.test(url)) {
        blocks.push({ id: newId(), type: "youtube", text: "", url });
      } else if (GMAP_RE.test(url)) {
        blocks.push({ id: newId(), type: "gmap", text: "", url });
      } else {
        blocks.push({ id: newId(), type: "link", text: url, url });
      }
      i++; continue;
    }
    // Otherwise treat as paragraph (potentially multi-line until blank)
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !HEADING_RE.test(lines[i]) && !TASK_RE.test(lines[i]) && !HR_RE.test(lines[i].trim()) && !QUOTE_RE.test(lines[i]) && !REMINDER_FENCE_START.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ id: newId(), type: "paragraph", text: buf.join("\n") });
  }
  if (blocks.length === 0) blocks.push(emptyParagraph());
  return blocks;
}

export function extractYoutubeId(url: string): string | null {
  const m = url.match(YOUTUBE_RE);
  return m ? m[1] : null;
}
export function isYoutube(url: string): boolean { return YOUTUBE_RE.test(url); }
export function isGmap(url: string): boolean { return GMAP_RE.test(url); }
