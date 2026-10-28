import * as Y from 'yjs';

export const LATEX_FIELD = 'latex';
export const META_FIELD = 'meta';
export const LATEX_SOURCE_MAX = 1_000_000;

export interface LatexJSON {
  type: 'latex';
  source: string;
}

export const LATEX_TEMPLATE = String.raw`\documentclass{article}
\usepackage{amsmath}

\begin{document}

\section{Giới thiệu}
Viết nội dung ở đây. Công thức trong dòng: $E = mc^2$.

Công thức riêng một dòng:
\[
  x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
\]

\end{document}
`;

export function isLatexJSON(json: unknown): json is LatexJSON {
  return (
    typeof json === 'object' &&
    json !== null &&
    (json as { type?: unknown }).type === 'latex' &&
    typeof (json as { source?: unknown }).source === 'string'
  );
}

export const latexJSON = (source: string): LatexJSON => ({
  type: 'latex',
  source: source.slice(0, LATEX_SOURCE_MAX),
});

export function isLatexDoc(ydoc: Y.Doc): boolean {
  return ydoc.getMap(META_FIELD).get('format') === 'LATEX';
}

export function latexToYDoc(source: string): Y.Doc {
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    ydoc.getMap(META_FIELD).set('format', 'LATEX');
    ydoc.getText(LATEX_FIELD).insert(0, source);
  });
  return ydoc;
}

export function replaceLatex(ydoc: Y.Doc, source: string, origin?: unknown) {
  const text = ydoc.getText(LATEX_FIELD);
  const current = text.toString();
  if (current === source) return;
  let start = 0;
  while (start < current.length && start < source.length && current[start] === source[start])
    start++;
  let endCur = current.length;
  let endNew = source.length;
  while (endCur > start && endNew > start && current[endCur - 1] === source[endNew - 1]) {
    endCur--;
    endNew--;
  }
  ydoc.transact(() => {
    ydoc.getMap(META_FIELD).set('format', 'LATEX');
    if (endCur > start) text.delete(start, endCur - start);
    if (endNew > start) text.insert(start, source.slice(start, endNew));
  }, origin);
}

const DROPPED_WITH_ARG =
  /\\(documentclass|usepackage|begin|end|label|ref|eqref|cite|includegraphics|vspace|hspace|newcommand|renewcommand)\*?(\[[^\]]*\])?(\{[^{}]*\})+/g;

export function latexToText(source: string): string {
  return source
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(DROPPED_WITH_ARG, ' ')
    .replace(/\\\\|\\[,;:!]/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, ' ')
    .replace(/\\([{}$&%#_])/g, '$1')
    .replace(/[{}$&^_~]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
