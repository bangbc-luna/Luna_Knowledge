const HONORIFICS = new Set(['anh', 'chi', 'em', 'ban', 'a', 'c', 'e']);

export function foldName(s: string): string {
  const folded = s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (folded.length > 1 && HONORIFICS.has(folded[0]!)) folded.shift();
  return folded.join(' ');
}

export function matchPerson(
  name: string,
  candidates: Array<{ id: string; name: string; email: string }>,
): string | null {
  const key = foldName(name);
  if (key === '') return null;

  const exact = candidates.filter((c) => foldName(c.name) === key);
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) return null;

  const loose = candidates.filter((c) => {
    const folded = foldName(c.name);
    const given = folded.slice(folded.lastIndexOf(' ') + 1);
    const local = foldName(c.email.split('@')[0] ?? '');
    return given === key || local === key;
  });
  return loose.length === 1 ? loose[0]!.id : null;
}
