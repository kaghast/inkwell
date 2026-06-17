import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Feather } from "lucide-react";
import type { User } from "@/types";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const hash = window.location.hash;
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) {
      navigate("/login", { replace: true });
      return;
    }
    const sessionId = m[1];

    (async () => {
      try {
        const { data } = await api.post<User>(
          "/auth/google/session",
          null,
          { headers: { "X-Session-ID": sessionId } }
        );
        setUser(data);
        navigate("/", { replace: true });
      } catch {
        navigate("/login", { replace: true });
      }
    })();
  }, [navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center paper" data-testid="auth-callback">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Feather className="w-5 h-5 animate-pulse" strokeWidth={1.25} />
        <span className="font-serif text-xl italic">Mürekkep kurutuluyor…</span>
      </div>
    </div>
  );
}
