import React, { useState } from "react";
import { useNavigate, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Feather } from "lucide-react";
import type { User } from "@/types";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
function googleLogin() {
  const redirectUrl = window.location.origin + "/";
  window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
}

type Tab = "login" | "register";

export default function Login() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState<Tab>("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [busy, setBusy] = useState(false);

  if (user && (user as User).user_id) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      if (tab === "login") {
        const { data } = await api.post<User>("/auth/login", { email: form.email, password: form.password });
        setUser(data);
        toast.success("Hoşgeldiniz");
      } else {
        const { data } = await api.post<User>("/auth/register", { email: form.email, password: form.password, name: form.name });
        setUser(data);
        toast.success("Hesap oluşturuldu");
      }
      const from = (location.state as { from?: string } | null)?.from || "/";
      nav(from, { replace: true });
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2 paper" data-testid="login-page">
      <div className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden border-r border-border" style={{ background: "hsl(var(--surface))" }}>
        <div className="flex items-center gap-2 text-foreground">
          <Feather className="w-5 h-5" strokeWidth={1.25} />
          <span className="font-serif text-2xl">Inkwell</span>
        </div>
        <div>
          <p className="text-xs tracking-[0.3em] uppercase text-muted-foreground mb-4">Bir günlük, bir defter</p>
          <h1 className="font-serif text-5xl lg:text-6xl leading-[0.95] tracking-tight">
            Düşüncelerinizi<br />
            <span className="text-[hsl(var(--accent-tag))]">mürekkep</span> gibi
            <br />kâğıda dökün.
          </h1>
          <p className="mt-6 text-muted-foreground max-w-md leading-relaxed">
            #etiket ve @kişi ile zenginleştirilmiş notlar, konum bilgisi, takvim ve
            tüm bunların hızlı erişilebilir bir akışı.
          </p>
        </div>
        <div className="font-mono text-xs text-muted-foreground">v1.0 — beta</div>
      </div>

      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm">
          <div className="flex lg:hidden items-center gap-2 mb-8">
            <Feather className="w-5 h-5" strokeWidth={1.25} />
            <span className="font-serif text-2xl">Inkwell</span>
          </div>
          <h2 className="font-serif text-3xl lg:text-4xl mb-1">
            {tab === "login" ? "Tekrar hoşgeldiniz" : "Hesap oluşturun"}
          </h2>
          <p className="text-sm text-muted-foreground mb-8">
            {tab === "login" ? "Notlarınıza erişmek için giriş yapın" : "Birkaç saniyede başlayın"}
          </p>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="w-full">
            <TabsList className="grid grid-cols-2 mb-6 bg-secondary">
              <TabsTrigger value="login" data-testid="tab-login">Giriş</TabsTrigger>
              <TabsTrigger value="register" data-testid="tab-register">Kayıt</TabsTrigger>
            </TabsList>
            <TabsContent value="login" />
            <TabsContent value="register" />
          </Tabs>

          <form onSubmit={submit} className="space-y-4">
            {tab === "register" && (
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs uppercase tracking-[0.2em]">İsim</Label>
                <Input
                  id="name"
                  data-testid="register-name-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Adınız"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs uppercase tracking-[0.2em]">E-posta</Label>
              <Input
                id="email"
                type="email"
                data-testid={tab === "login" ? "login-email-input" : "register-email-input"}
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="siz@ornek.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs uppercase tracking-[0.2em]">Şifre</Label>
              <Input
                id="password"
                type="password"
                data-testid={tab === "login" ? "login-password-input" : "register-password-input"}
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
              />
            </div>

            <Button
              type="submit"
              disabled={busy}
              data-testid={tab === "login" ? "login-submit-btn" : "register-submit-btn"}
              className="w-full bg-foreground text-background hover:bg-foreground/90 rounded-sm font-medium tracking-wide"
            >
              {busy ? "Bekleyin..." : tab === "login" ? "Giriş Yap" : "Hesap Oluştur"}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-xs uppercase tracking-[0.2em]">
              <span className="px-2 bg-background text-muted-foreground">veya</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            data-testid="google-login-btn"
            className="w-full rounded-sm border-foreground/20 hover:bg-secondary"
            onClick={googleLogin}
          >
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
              <path fill="currentColor" d="M21.35 11.1h-9.17v2.97h5.27c-.23 1.36-1.62 3.99-5.27 3.99-3.17 0-5.76-2.62-5.76-5.86s2.59-5.86 5.76-5.86c1.8 0 3.01.77 3.7 1.43l2.53-2.43C16.84 3.92 14.66 3 12.18 3 7.13 3 3.04 7.04 3.04 12s4.09 9 9.14 9c5.28 0 8.78-3.71 8.78-8.93 0-.6-.06-1.06-.16-1.97z" />
            </svg>
            Google ile devam et
          </Button>
        </div>
      </div>
    </div>
  );
}
