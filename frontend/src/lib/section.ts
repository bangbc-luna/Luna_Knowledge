"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { NodeSection } from "./types";

let current: NodeSection | null = null;
const listeners = new Set<() => void>();

export function useReportSection(section: NodeSection | null | undefined) {
  useEffect(() => {
    if (!section) return;
    current = section;
    listeners.forEach((l) => l());
    return () => {
      if (current === section) {
        current = null;
        listeners.forEach((l) => l());
      }
    };
  }, [section]);
}

export function useActiveSection() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
