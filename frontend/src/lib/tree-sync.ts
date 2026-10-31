"use client";

import { useSyncExternalStore } from "react";

const ticks = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function invalidateTree(wsId: string) {
  ticks.set(wsId, (ticks.get(wsId) ?? 0) + 1);
  listeners.forEach((l) => l());
}

export function useTreeTick(wsId: string | null): number {
  return useSyncExternalStore(
    subscribe,
    () => (wsId ? (ticks.get(wsId) ?? 0) : 0),
    () => 0,
  );
}

const expanded = new Map<string, Set<string>>();
let expandedVersion = 0;
const expandedListeners = new Set<() => void>();

function subscribeExpanded(listener: () => void) {
  expandedListeners.add(listener);
  return () => {
    expandedListeners.delete(listener);
  };
}

function setOf(scope: string) {
  let set = expanded.get(scope);
  if (!set) {
    set = new Set();
    expanded.set(scope, set);
  }
  return set;
}

function emitExpanded() {
  expandedVersion++;
  expandedListeners.forEach((l) => l());
}

export function expandTreeNodes(scope: string, ids: string[]) {
  const set = setOf(scope);
  const added = ids.filter((id) => !set.has(id));
  if (!added.length) return;
  added.forEach((id) => set.add(id));
  emitExpanded();
}

export function toggleTreeNode(scope: string, id: string) {
  const set = setOf(scope);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  emitExpanded();
}

export function useExpandedTree(scope: string): ReadonlySet<string> {
  useSyncExternalStore(
    subscribeExpanded,
    () => expandedVersion,
    () => 0,
  );
  return setOf(scope);
}
