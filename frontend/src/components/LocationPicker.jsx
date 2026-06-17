import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MiniMap from "@/components/MiniMap";
import { toast } from "sonner";
import { MapPin, Locate } from "lucide-react";

export default function LocationPicker({ open, onOpenChange, initial, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [coords, setCoords] = useState(
    initial?.lat != null ? { lat: initial.lat, lng: initial.lng } : null
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setCoords(initial?.lat != null ? { lat: initial.lat, lng: initial.lng } : null);
    }
  }, [open, initial]);

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
      <DialogContent className="max-w-lg bg-card border-border rounded-sm" data-testid="location-picker-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl flex items-center gap-2">
            <MapPin className="w-4 h-4" strokeWidth={1.25} />
            Konum
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            onClick={captureBrowserLocation}
            disabled={busy}
            data-testid="capture-location-btn"
            className="w-full rounded-sm"
          >
            <Locate className="w-4 h-4 mr-2" strokeWidth={1.25} />
            {busy ? "Alınıyor..." : "Tarayıcı konumumu kullan"}
          </Button>

          {coords && (
            <MiniMap
              lat={coords.lat}
              lng={coords.lng}
              height={200}
              interactive
              onPick={(la, ln) => setCoords({ lat: la, lng: ln })}
            />
          )}
          {coords && (
            <p className="text-xs text-muted-foreground font-mono">
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} — haritaya tıklayarak değiştirebilirsiniz
            </p>
          )}

          <Input
            placeholder="Yer adı (örn: Ev, Ofis)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="location-name-input"
            className="rounded-sm"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="location-cancel-btn">İptal</Button>
          <Button onClick={save} disabled={!coords} data-testid="location-save-btn" className="bg-foreground text-background hover:bg-foreground/90 rounded-sm">
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
