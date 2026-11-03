const HONORIFICS = new Set(['anh', 'chi', 'em', 'ban', 'a', 'c', 'e']);

function foldPlain(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function foldName(s: string): string {
  const folded = foldPlain(s);
  if (folded.length > 1 && HONORIFICS.has(folded[0]!)) folded.shift();
  return folded.join(' ');
}

export function matchPerson(
  name: string,
  allCandidates: Array<{ id: string; name: string; email: string }>,
  excludeIds?: Set<string>,
): string | null {
  const key = foldName(name);
  if (key === '') return null;
  const candidates = excludeIds
    ? allCandidates.filter((c) => !excludeIds.has(c.id))
    : allCandidates;

  const plain = foldPlain(name).join(' ');
  for (const k of new Set([plain, key])) {
    const exact = candidates.filter((c) => foldPlain(c.name).join(' ') === k);
    if (exact.length === 1) return exact[0]!.id;
    if (exact.length > 1) return null;
  }

  const loose = candidates.filter((c) => {
    const given = foldPlain(c.name).at(-1);
    const local = foldPlain(c.email.split('@')[0] ?? '').join(' ');
    return given === key || local === key;
  });
  return loose.length === 1 ? loose[0]!.id : null;
}
