import React, { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";
import { useFilter } from "@/contexts/FilterContext";

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

export default function MarkdownView({ content }: { content: string }) {
  return (
    <div className="prose-paper" data-testid="markdown-view">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{transformChildren(children)}</p>,
          li: ({ children }) => <li>{transformChildren(children)}</li>,
          h1: ({ children }) => <h1>{transformChildren(children)}</h1>,
          h2: ({ children }) => <h2>{transformChildren(children)}</h2>,
          h3: ({ children }) => <h3>{transformChildren(children)}</h3>,
        }}
      >
        {content || ""}
      </ReactMarkdown>
    </div>
  );
}
