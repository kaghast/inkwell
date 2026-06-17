import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import api from "@/lib/api";
import type { User } from "@/types";

type UserState = User | false | null;

interface AuthCtx {
  user: UserState;
  loading: boolean;
  setUser: (u: UserState) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserState>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get<User>("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const value: AuthCtx = {
    user,
    loading,
    setUser,
    refresh: checkAuth,
    logout: async () => {
      try {
        await api.post("/auth/logout");
      } catch {
        /* ignore */
      }
      setUser(false);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthCtx => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
