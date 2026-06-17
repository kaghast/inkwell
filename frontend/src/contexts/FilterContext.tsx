import React, { createContext, useContext, ReactNode } from "react";

export type FilterType = "tag" | "person" | "location";

interface FilterCtx {
  // Returns true if a multi-filter action was handled (ctrl/meta-click).
  // Default Link navigation is used when this returns false.
  tryAddFilter: (type: FilterType, value: string, e: React.MouseEvent) => boolean;
}

const noopCtx: FilterCtx = { tryAddFilter: () => false };

const FilterContext = createContext<FilterCtx>(noopCtx);

export function FilterProvider({ value, children }: { value: FilterCtx; children: ReactNode }) {
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilter(): FilterCtx {
  return useContext(FilterContext);
}
