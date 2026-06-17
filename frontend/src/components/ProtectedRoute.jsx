import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Feather } from "lucide-react";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center paper" data-testid="auth-loading">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Feather className="w-5 h-5 animate-pulse" strokeWidth={1.25} />
          <span className="font-serif text-xl italic">Yükleniyor…</span>
        </div>
      </div>
    );
  }
  if (!user || !user.user_id) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
