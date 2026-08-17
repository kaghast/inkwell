import React, { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Link as LinkIcon } from "lucide-react";
import { fetchLinkPreview } from "@/lib/uploads";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (title: string, url: string) => void;
  autoPreview?: boolean;
}

export default function LinkDialog({ open, onOpenChange, onConfirm, autoPreview = true }: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (open) { setUrl(""); setTitle(""); } }, [open]);

  async function doPreview() {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const res = await fetchLinkPreview(url.trim());
      setTitle(res.title || url.trim());
    } catch {
      setTitle(url.trim());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoPreview) return;
    if (!url.trim()) return;
    if (!/^https?:\/\//i.test(url.trim())) return;
    const t = window.setTimeout(doPreview, 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, autoPreview]);

  function confirm() {
    if (!url.trim()) return;
    onConfirm(title.trim() || url.trim(), url.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border rounded-lg" data-testid="link-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl flex items-center gap-2">
            <LinkIcon className="w-4 h-4" strokeWidth={1.5} /> Link ekle
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e: any) => setUrl(e.target.value)}
            className="rounded-md"
            data-testid="link-url-input"
            autoFocus
          />
          <div className="relative">
            <Input
              placeholder="Başlık (otomatik doldurulur)"
              value={title}
              onChange={(e: any) => setTitle(e.target.value)}
              className="rounded-md pr-8"
              data-testid="link-title-input"
            />
            {loading && (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button onClick={confirm} disabled={!url.trim()} className="bg-foreground text-background hover:bg-foreground/90 rounded-md" data-testid="link-confirm-btn">
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
