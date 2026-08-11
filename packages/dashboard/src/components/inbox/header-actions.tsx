"use client";

import { createContext, useContext } from "react";

export type HeaderActionsSetter = (node: React.ReactNode | null) => void;

export const InboxHeaderActionsContext = createContext<HeaderActionsSetter>(() => {});

export function useInboxHeaderActions(): HeaderActionsSetter {
  return useContext(InboxHeaderActionsContext);
}
