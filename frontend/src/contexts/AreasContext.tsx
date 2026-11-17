import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import type { Area } from "@/types";

interface AreasCtx {
  areas: Area[];
  areaMap: Record<string, Area>;
  reload: () => Promise<void>;
}

const AreasContext = createContext<AreasCtx>({ areas: [], areaMap: {}, reload: async () => {} });

export function AreasProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [areas, setAreas] = useState<Area[]>([]);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get<Area[]>("/areas");
      setAreas(data || []);
    } catch {
      /* not signed in yet */
    }
  }, []);

  const signedIn = !!(user && (user as any).user_id);
  useEffect(() => {
    if (signedIn) reload();
    else setAreas([]);
  }, [signedIn, reload]);

  const value = useMemo(() => {
    const areaMap: Record<string, Area> = {};
    areas.forEach((a) => (areaMap[a.area_id] = a));
    return { areas, areaMap, reload };
  }, [areas, reload]);

  return <AreasContext.Provider value={value}>{children}</AreasContext.Provider>;
}

export const useAreas = (): AreasCtx => useContext(AreasContext);
