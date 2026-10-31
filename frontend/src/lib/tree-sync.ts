"use client";

import { useSyncExternalStore } from "react";
import { useAuth } from "./auth";
import type { NodeSection } from "./types";

const workspaceTicks = new Map<string, number>();
const branchTicks = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const branchKey = (wsId: string, parentId: string | null) => `${wsId}:${parentId ?? ""}`;
const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

export function invalidateTree(wsId: string, parentIds?: Array<string | null>) {
  if (parentIds?.length) new Set(parentIds).forEach((id) => bump(branchTicks, branchKey(wsId, id)));
  else bump(workspaceTicks, wsId);
  listeners.forEach((l) => l());
}

export function useTreeTick(wsId: string | null): number {
  return useSyncExternalStore(
    subscribe,
    () => (wsId ? (workspaceTicks.get(wsId) ?? 0) : 0),
    () => 0,
  );
}

export function useBranchTick(wsId: string, parentId: string | null): string {
  const key = branchKey(wsId, parentId);
  return useSyncExternalStore(
    subscribe,
    () => `${workspaceTicks.get(wsId) ?? 0}:${branchTicks.get(key) ?? 0}`,
    () => "0:0",
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

export function pruneExpandedExcept(prefix: string) {
  [...expanded.keys()].filter((k) => !k.startsWith(prefix)).forEach((k) => expanded.delete(k));
}

export function useTreeUser(): string {
  return useAuth().me?.id ?? "anon";
}

export function useTreeScope(wsId: string, section: NodeSection): string {
  return `${useTreeUser()}:${wsId}:${section}`;
}
