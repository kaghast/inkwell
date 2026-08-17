import React, { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BellRing } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (isoDateTime: string, text: string) => void;
  initial?: { at?: string; text?: string };
}

function nowLocalRoundedISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ReminderDialog({ open, onOpenChange, onConfirm, initial }: Props) {
  const [dt, setDt] = useState<string>(initial?.at?.slice(0, 16) || nowLocalRoundedISO());
  const [text, setText] = useState<string>(initial?.text || "");

  useEffect(() => {
    if (open) {
      setDt(initial?.at?.slice(0, 16) || nowLocalRoundedISO());
      setText(initial?.text || "");
    }
  }, [open, initial]);

  function confirm() {
    if (!dt) return;
    // Convert local input to full ISO with local timezone, then to UTC
    const local = new Date(dt);
    onConfirm(local.toISOString(), text.trim() || "Hatırlatma");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border rounded-lg" data-testid="reminder-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl flex items-center gap-2">
            <BellRing className="w-4 h-4" strokeWidth={1.5} /> Hatırlatma
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">Tarih & Saat</label>
            <Input
              type="datetime-local"
              value={dt}
              onChange={(e: any) => setDt(e.target.value)}
              className="mt-1 font-mono rounded-md"
              data-testid="reminder-datetime-input"
            />
          </div>
          <div>
            <label className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">Metin</label>
            <Input
              value={text}
              onChange={(e: any) => setText(e.target.value)}
              placeholder="Ne için hatırlatma?"
              className="mt-1 rounded-md"
              data-testid="reminder-text-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button onClick={confirm} className="bg-foreground text-background hover:bg-foreground/90 rounded-md" data-testid="reminder-confirm-btn">
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
