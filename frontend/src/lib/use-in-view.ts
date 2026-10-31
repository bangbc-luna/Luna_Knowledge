"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Entry = { cb: () => void };

let observer: IntersectionObserver | null = null;
const entries = new WeakMap<Element, Entry>();

function shared(): IntersectionObserver {
  if (!observer) {
    observer = new IntersectionObserver(
      (list) => {
        for (const item of list) {
          if (!item.isIntersecting) continue;
          const entry = entries.get(item.target);
          if (!entry) continue;
          observer?.unobserve(item.target);
          entries.delete(item.target);
          entry.cb();
        }
      },
      { rootMargin: "200px" },
    );
  }
  return observer;
}

export function useInView<T extends Element>(key: string): [(node: T | null) => void, boolean] {
  const [seenKey, setSeenKey] = useState<string | null>(null);
  const current = useRef<T | null>(null);
  const ref = useCallback(
    (node: T | null) => {
      if (current.current) {
        shared().unobserve(current.current);
        entries.delete(current.current);
      }
      current.current = node;
      if (!node) return;
      if (typeof IntersectionObserver === "undefined") {
        setSeenKey(key);
        return;
      }
      entries.set(node, { cb: () => setSeenKey(key) });
      shared().observe(node);
    },
    [key],
  );
  useEffect(
    () => () => {
      if (current.current) {
        shared().unobserve(current.current);
        entries.delete(current.current);
      }
    },
    [],
  );
  return [ref, seenKey === key];
}
