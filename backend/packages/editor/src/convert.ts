import { generateHTML, generateJSON } from '@tiptap/html';
import type { JSONContent } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import {
  prosemirrorJSONToYDoc,
  updateYFragment,
  yXmlFragmentToProsemirrorJSON,
} from '@tiptap/y-tiptap';
import TurndownService from 'turndown';
import * as Y from 'yjs';
import { editorExtensions, editorSchema, YJS_FIELD } from './extensions.js';

export type DocJSON = JSONContent;

export const emptyDoc = (): DocJSON => ({ type: 'doc', content: [{ type: 'paragraph' }] });

export function ydocToJSON(ydoc: Y.Doc): DocJSON {
  const json = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(YJS_FIELD)) as DocJSON;
  return json.content?.length ? json : emptyDoc();
}

export function stateToJSON(state: Uint8Array): DocJSON {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  return ydocToJSON(ydoc);
}

export function jsonToYDoc(json: DocJSON): Y.Doc {
  return prosemirrorJSONToYDoc(editorSchema, normalize(json), YJS_FIELD);
}

export function jsonToState(json: DocJSON): Uint8Array {
  return Y.encodeStateAsUpdate(jsonToYDoc(json));
}

export function replaceContent(ydoc: Y.Doc, json: DocJSON, origin?: unknown) {
  const node = PMNode.fromJSON(editorSchema, normalize(json));
  const fragment = ydoc.getXmlFragment(YJS_FIELD);
  ydoc.transact(() => {
    updateYFragment(ydoc, fragment, node, { mapping: new Map(), isOMark: new Map() });
  }, origin);
}

export function jsonToHTML(json: DocJSON): string {
  return generateHTML(normalize(json), editorExtensions);
}

export function htmlToJSON(html: string): DocJSON {
  return normalize(generateJSON(html, editorExtensions) as DocJSON);
}

export function jsonToText(json: DocJSON): string {
  const node = PMNode.fromJSON(editorSchema, normalize(json));
  return node
    .textBetween(0, node.content.size, '\n', ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function wordCount(text: string): number {
  const words = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return words ? words.length : 0;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndown.addRule('commentMark', {
  filter: (n) => n.nodeName === 'SPAN' && n.hasAttribute('data-thread-id'),
  replacement: (c) => c,
});

export function jsonToMarkdown(json: DocJSON): string {
  return turndown.turndown(jsonToHTML(json));
}

function normalize(json: DocJSON): DocJSON {
  if (json?.type !== 'doc') return emptyDoc();
  const node = PMNode.fromJSON(editorSchema, json.content?.length ? json : emptyDoc());
  node.check();
  return node.toJSON() as DocJSON;
}
