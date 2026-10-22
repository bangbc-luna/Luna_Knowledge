import type { SearchPart } from './search.schemas.js';

export interface Match {
  start: number;
  length: number;
}

export function splitMatches(
  chars: string[],
  matches: Match[],
  from = 0,
  to = chars.length,
): SearchPart[] {
  const parts: SearchPart[] = [];
  let pos = from;
  const sorted = [...matches]
    .filter((m) => m.start + m.length > from && m.start < to)
    .sort((a, b) => a.start - b.start);
  const merged: Match[] = [];
  for (const m of sorted) {
    const last = merged.at(-1);
    const gap = last ? chars.slice(last.start + last.length, m.start).join('') : null;
    if (last && gap !== null && /^\s*$/.test(gap)) {
      last.length = Math.max(last.length, m.start + m.length - last.start);
    } else merged.push({ ...m });
  }
  for (const m of merged) {
    const s = Math.max(m.start, pos);
    const e = Math.min(m.start + m.length, to);
    if (e <= s) continue;
    if (s > pos) parts.push({ text: chars.slice(pos, s).join(''), match: false });
    parts.push({ text: chars.slice(s, e).join(''), match: true });
    pos = e;
  }
  if (pos < to) parts.push({ text: chars.slice(pos, to).join(''), match: false });
  return parts;
}

export function snippetAround(chars: string[], matches: Match[], radius = 80): SearchPart[] | null {
  const first = [...matches].sort((a, b) => a.start - b.start)[0];
  if (!first || first.start >= chars.length) return null;
  let from = Math.max(0, first.start - radius);
  let to = Math.min(chars.length, first.start + first.length + radius * 2);
  while (from > 0 && from > first.start - radius - 20 && !/\s/.test(chars[from - 1]!)) from--;
  while (to < chars.length && to < first.start + radius * 2 + 20 && !/\s/.test(chars[to]!)) to++;
  const parts = splitMatches(chars, matches, from, to).map((p) => ({
    ...p,
    text: p.text.replace(/\s+/g, ' '),
  }));
  if (from > 0) parts.unshift({ text: '…', match: false });
  if (to < chars.length) parts.push({ text: '…', match: false });
  return parts;
}
