export type LinkPart = { kind: "text" | "link"; value: string };

const URL_PATTERN = /https?:\/\/\S+/g;
const TRAILING = /[.,)]+$/;

export function linkify(text: string): LinkPart[] {
  const parts: LinkPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = raw.replace(TRAILING, "");
    const start = match.index;
    if (!/^https?:\/\/./.test(url)) continue;
    if (start > last) parts.push({ kind: "text", value: text.slice(last, start) });
    parts.push({ kind: "link", value: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}
