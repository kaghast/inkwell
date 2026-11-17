// #tag / @person parsing — must stay in sync with backend/server.py
// (TAG_RE, MENTION_RE, normalize_name). A token follows whitespace or line start
// and consists of letters, digits, "_" and "-".
export const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]+)/gu;
export const MEN_RE = /(^|\s)@([\p{L}\p{N}_-]+)/gu;

const TURKISH_CHARS = /[çğışöüÇĞŞÖÜİı]/;

/** Canonical tag/person name: NFC + lowercase, Turkish casing for Turkish words. */
export function normalizeName(raw: string): string {
  let s = (raw || "").normalize("NFC").trim();
  if (TURKISH_CHARS.test(s)) s = s.replace(/I/g, "ı");
  return s.replace(/İ/g, "i").toLowerCase().replace(/i̇/g, "i");
}
