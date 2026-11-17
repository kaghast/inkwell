import React, { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { googleSignIn } from "@/lib/api";
import { toast } from "sonner";
import { Feather } from "lucide-react";
import type { User } from "@/types";

const ERRORS: Record<string, string> = {
  access_denied: "Google girişi iptal edildi.",
  invalid_state: "Oturum doğrulanamadı, lütfen tekrar deneyin.",
  google_failed: "Google ile iletişim kurulamadı, lütfen tekrar deneyin.",
  email_not_verified: "Google hesabınızın e-posta adresi doğrulanmamış.",
};

export default function Login() {
  const { user } = useAuth();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const authError = search.get("auth_error");
  const from = (location.state as { from?: string } | null)?.from || search.get("next") || "/";

  useEffect(() => {
    if (authError) toast.error(ERRORS[authError] || "Giriş başarısız oldu.");
  }, [authError]);

  if (user && (user as User).user_id) return <Navigate to={from} replace />;

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
          <h2 className="font-serif text-3xl lg:text-4xl mb-1">Hoşgeldiniz</h2>
          <p className="text-sm text-muted-foreground mb-8">
            Google hesabınızla giriş yapın. Bir kez giriş yaptıktan sonra bu cihazda oturumunuz açık kalır.
          </p>

          <Button
            type="button"
            data-testid="google-login-btn"
            className="w-full bg-foreground text-background hover:bg-foreground/90 rounded-sm font-medium tracking-wide"
            onClick={() => googleSignIn({ next: from })}
          >
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M21.35 11.1h-9.17v2.97h5.27c-.23 1.36-1.62 3.99-5.27 3.99-3.17 0-5.76-2.62-5.76-5.86s2.59-5.86 5.76-5.86c1.8 0 3.01.77 3.7 1.43l2.53-2.43C16.84 3.92 14.66 3 12.18 3 7.13 3 3.04 7.04 3.04 12s4.09 9 9.14 9c5.28 0 8.78-3.71 8.78-8.93 0-.6-.06-1.06-.16-1.97z" />
            </svg>
            Google ile giriş yap
          </Button>
        </div>
      </div>
    </div>
  );
}
