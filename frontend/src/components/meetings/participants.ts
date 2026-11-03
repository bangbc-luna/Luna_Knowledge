import type { Participant } from "livekit-client";

export function dedupeParticipants<T extends Participant>(list: T[]): T[] {
  const byIdentity = new Map<string, T>();
  for (const p of list) {
    const current = byIdentity.get(p.identity);
    if (!current || prefers(p, current)) byIdentity.set(p.identity, p);
  }
  return list.filter((p) => byIdentity.get(p.identity) === p);
}

function prefers(next: Participant, current: Participant): boolean {
  if (current.isLocal) return false;
  if (next.isLocal) return true;
  return (next.joinedAt?.getTime() ?? 0) > (current.joinedAt?.getTime() ?? 0);
}
