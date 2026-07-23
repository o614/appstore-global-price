"use client";

import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";

type PriceShareContextValue = {
  isShareOpen: boolean;
  openShare: () => void;
  closeShare: () => void;
};

const PriceShareContext = createContext<PriceShareContextValue | null>(null);

export function PriceShareProvider({ children }: PropsWithChildren) {
  const [isShareOpen, setIsShareOpen] = useState(false);
  const openShare = useCallback(() => setIsShareOpen(true), []);
  const closeShare = useCallback(() => setIsShareOpen(false), []);
  const value = useMemo(() => ({
    isShareOpen,
    openShare,
    closeShare,
  }), [closeShare, isShareOpen, openShare]);

  return <PriceShareContext.Provider value={value}>{children}</PriceShareContext.Provider>;
}

export function usePriceShare() {
  const context = useContext(PriceShareContext);
  if (!context) throw new Error("usePriceShare must be used inside PriceShareProvider");
  return context;
}
