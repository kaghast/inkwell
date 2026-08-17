import React from "react";
import {
  Type, Hash, CheckSquare, Minus, Quote, Link as LinkIcon,
  Image as ImageIcon, Youtube, MapPin, BellRing,
} from "lucide-react";
import type { BlockType } from "@/lib/blocks";

export interface BlockOption {
  type: BlockType;
  label: string;
  hint: string;
  keywords: string[];
  icon: any;
}

export const BLOCK_OPTIONS: BlockOption[] = [
  { type: "paragraph", label: "Paragraf", hint: "Düz metin", keywords: ["paragraf","p","text","metin"], icon: Type },
  { type: "heading1", label: "Başlık 1", hint: "En büyük başlık", keywords: ["h1","başlık","heading","büyük"], icon: Hash },
  { type: "heading2", label: "Başlık 2", hint: "Bölüm başlığı", keywords: ["h2","başlık","heading"], icon: Hash },
  { type: "heading3", label: "Başlık 3", hint: "Alt bölüm", keywords: ["h3","başlık","heading"], icon: Hash },
  { type: "heading4", label: "Başlık 4", hint: "Küçük başlık", keywords: ["h4","başlık","heading"], icon: Hash },
  { type: "heading5", label: "Başlık 5", hint: "Küçük başlık", keywords: ["h5","başlık","heading"], icon: Hash },
  { type: "heading6", label: "Başlık 6", hint: "En küçük başlık", keywords: ["h6","başlık","heading"], icon: Hash },
  { type: "task", label: "Görev", hint: "İşaretlenebilir onay kutusu", keywords: ["task","todo","görev","yapılacak"], icon: CheckSquare },
  { type: "divider", label: "Çizgi", hint: "Yatay ayırıcı", keywords: ["divider","hr","çizgi","ayır"], icon: Minus },
  { type: "quote", label: "Alıntı", hint: "Alıntı bloğu", keywords: ["quote","alıntı","söz"], icon: Quote },
  { type: "link", label: "Link", hint: "URL yapıştır — başlık otomatik", keywords: ["link","bağlantı","url"], icon: LinkIcon },
  { type: "image", label: "Resim", hint: "Yükle veya sürükle-bırak", keywords: ["image","resim","fotoğraf","upload"], icon: ImageIcon },
  { type: "youtube", label: "YouTube", hint: "Video embed önizleme", keywords: ["youtube","video","yt"], icon: Youtube },
  { type: "gmap", label: "Google Maps", hint: "Harita embed önizleme", keywords: ["map","harita","gmap","konum"], icon: MapPin },
  { type: "reminder", label: "Hatırlatma", hint: "Tarih & saat, bildirim gelir", keywords: ["reminder","hatırlatma","alarm"], icon: BellRing },
];

export function filterBlockOptions(query: string): BlockOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCK_OPTIONS;
  return BLOCK_OPTIONS.filter(
    (o) =>
      o.label.toLowerCase().includes(q) ||
      o.hint.toLowerCase().includes(q) ||
      o.keywords.some((k) => k.toLowerCase().includes(q))
  );
}
