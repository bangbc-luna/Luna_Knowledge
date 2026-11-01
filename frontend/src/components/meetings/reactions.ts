"use client";

import { useDataChannel, useLocalParticipant } from "@livekit/components-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export const REACTIONS = ["👍", "👏", "😂", "❤️", "🎉", "😮"] as const;
export type Reaction = (typeof REACTIONS)[number];

const TOPIC = "luna.reaction";
const SHOW_MS = 3000;
const MIN_GAP_MS = 500;

const isReaction = (value: unknown): value is Reaction => typeof value === "string" && (REACTIONS as readonly string[]).includes(value);

function decode(payload: Uint8Array): Reaction | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (typeof value !== "object" || value === null) return null;
    const emoji = (value as { emoji?: unknown }).emoji;
    return isReaction(emoji) ? emoji : null;
  } catch {
    return null;
  }
}

export interface ActiveReaction {
  emoji: Reaction;
  key: number;
}

export const ReactionsContext = createContext<Record<string, ActiveReaction>>({});
export const useActiveReaction = (identity: string): ActiveReaction | undefined => useContext(ReactionsContext)[identity];

export function useReactions() {
  const { localParticipant } = useLocalParticipant();
  const [active, setActive] = useState<Record<string, ActiveReaction>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastSent = useRef(0);
  const counter = useRef(0);
  const lastReceived = useRef(new Map<string, number>());

  const show = useCallback((identity: string, emoji: Reaction) => {
    counter.current += 1;
    const key = counter.current;
    setActive((prev) => ({ ...prev, [identity]: { emoji, key } }));
    const existing = timers.current.get(identity);
    if (existing) clearTimeout(existing);
    timers.current.set(
      identity,
      setTimeout(() => {
        timers.current.delete(identity);
        setActive((prev) => {
          if (prev[identity]?.key !== key) return prev;
          const next = { ...prev };
          delete next[identity];
          return next;
        });
      }, SHOW_MS),
    );
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending.values()) clearTimeout(id);
      pending.clear();
    };
  }, []);

  useDataChannel(TOPIC, (msg) => {
    const from = msg.from;
    if (!from || from.isLocal) return;
    const now = Date.now();
    const prev = lastReceived.current.get(from.identity) ?? 0;
    if (now - prev < MIN_GAP_MS) return;
    const emoji = decode(msg.payload);
    if (!emoji) return;
    lastReceived.current.set(from.identity, now);
    show(from.identity, emoji);
  });

  const send = useCallback(
    (emoji: Reaction) => {
      const now = Date.now();
      if (now - lastSent.current < MIN_GAP_MS) return;
      lastSent.current = now;
      show(localParticipant.identity, emoji);
      void localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ emoji })), { reliable: false, topic: TOPIC }).catch(() => undefined);
    },
    [localParticipant, show],
  );

  return useMemo(() => ({ active, send }), [active, send]);
}
