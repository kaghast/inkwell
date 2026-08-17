import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MiniMap from "@/components/MiniMap";
import api from "@/lib/api";
import { toast } from "sonner";
import { MapPin, Locate, Search, Loader2 } from "lucide-react";

interface InitialLocation {
  name?: string;
  lat?: number;
  lng?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: InitialLocation;
  onSave: (loc: { name: string; lat: number; lng: number }) => void;
}

interface SearchResult {
  display_name: string;
  name?: string;
  lat: number;
  lng: number;
}

export default function LocationPicker({ open, onOpenChange, initial, onSave }: Props) {
  const [name, setName] = useState<string>(initial?.name || "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    initial?.lat != null && initial?.lng != null ? { lat: initial.lat, lng: initial.lng } : null
  );
  const [busy, setBusy] = useState(false);

  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setCoords(initial?.lat != null && initial?.lng != null ? { lat: initial.lat, lng: initial.lng } : null);
      setQuery(""); setResults([]);
    }
  }, [open, initial]);

  function runSearch(q: string) {
    if (abortRef.current) abortRef.current.abort();
    if (!q.trim()) { setResults([]); return; }
    const controller = new AbortController();
    abortRef.current = controller;
    setSearching(true);
    api
      .get<SearchResult[]>("/geocode", { params: { q, limit: 6 }, signal: controller.signal as any })
      .then((res) => {
        setResults(Array.isArray(res.data) ? res.data : []);
      })
      .catch((err) => {
        if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
        toast.error("Arama başarısız oldu");
      })
      .finally(() => setSearching(false));
  }

  function onQueryChange(v: string) {
    setQuery(v);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => runSearch(v), 450);
  }

  function onSelectResult(r: SearchResult) {
    const lat = r.lat;
    const lng = r.lng;
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    setCoords({ lat, lng });
    // Suggest a short label
    const shortName = (r.name && r.name.trim()) || r.display_name.split(",")[0].trim();
    if (!name.trim()) setName(shortName);
    setResults([]);
    setQuery(r.display_name);
  }

  function captureBrowserLocation() {
    if (!navigator.geolocation) {
      toast.error("Tarayıcınız konum desteklemiyor");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setBusy(false);
      },
      (err) => {
        toast.error("Konum alınamadı: " + err.message);
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function save() {
    if (!coords) {
      toast.error("Önce konum seçin");
      return;
    }
    onSave({ name: name.trim() || `Yer ${new Date().toLocaleTimeString()}`, lat: coords.lat, lng: coords.lng });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border rounded-lg" data-testid="location-picker-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl flex items-center gap-2">
            <MapPin className="w-4 h-4" strokeWidth={1.5} />
            Konum
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" strokeWidth={1.75} />
            <Input
              value={query}
              onChange={(e: any) => onQueryChange(e.target.value)}
              onKeyDown={(e: any) => { if (e.key === "Enter") { e.preventDefault(); runSearch(query); } }}
              placeholder="Adres veya yer ara… (örn: Galata Kulesi, İstanbul)"
              data-testid="location-search-input"
              className="pl-10 pr-10 rounded-md"
              autoComplete="off"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" strokeWidth={1.75} />
            )}
            {results.length > 0 && (
              <ul
                className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover/98 backdrop-blur-xl shadow-md"
                data-testid="location-search-results"
              >
                {results.map((r, i) => (
                  <li
                    key={`${r.lat}-${r.lng}-${i}`}
                    onMouseDown={(e) => { e.preventDefault(); onSelectResult(r); }}
                    className="px-3 py-2 cursor-pointer hover:bg-accent flex items-start gap-2 text-sm border-b border-border last:border-b-0"
                    data-testid={`location-search-result-${i}`}
                  >
                    <MapPin className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" strokeWidth={1.75} />
                    <span className="leading-tight">{r.display_name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={captureBrowserLocation}
            disabled={busy}
            data-testid="capture-location-btn"
            className="w-full rounded-md"
          >
            <Locate className="w-4 h-4 mr-2" strokeWidth={1.5} />
            {busy ? "Alınıyor..." : "Tarayıcı konumumu kullan"}
          </Button>

          {coords && (
            <MiniMap
              lat={coords.lat}
              lng={coords.lng}
              height={220}
              interactive
              onPick={(la, ln) => setCoords({ lat: la, lng: ln })}
            />
          )}
          {coords && (
            <p className="text-xs text-muted-foreground font-mono">
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} — haritaya tıklayarak ince ayar yapabilirsiniz
            </p>
          )}

          <Input
            placeholder="Yer adı (örn: Ev, Ofis, Galata Kulesi)"
            value={name}
            onChange={(e: any) => setName(e.target.value)}
            data-testid="location-name-input"
            className="rounded-md"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="location-cancel-btn">İptal</Button>
          <Button onClick={save} disabled={!coords} data-testid="location-save-btn" className="bg-foreground text-background hover:bg-foreground/90 rounded-md">
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
