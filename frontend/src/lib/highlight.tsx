import React, { ReactNode } from "react";

// Escape a raw string so it can be used inside a RegExp.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Wrap every case-insensitive occurrence of `query` inside `text` with a
// <mark class="search-hit"> element. Returns an array of nodes (strings + <mark>).
export function highlightText(text: string, query: string, keyPrefix = "hl"): ReactNode[] {
  const q = query.trim();
  if (!q || !text) return [text];
  const re = new RegExp(escapeRegExp(q), "gi");
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark key={`${keyPrefix}-${idx++}`} className="search-hit">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
    // Prevent infinite loop on zero-length matches (should not happen here).
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
