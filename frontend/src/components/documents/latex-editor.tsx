"use client";

import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { LATEX_FIELD } from "@/lib/latex";
import type { CollabSession } from "./use-collab";

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.tagName], color: "#4338ca" },
  { tag: tags.comment, color: "#8a8a8a", fontStyle: "italic" },
  { tag: [tags.bracket, tags.brace], color: "#a16207" },
  { tag: [tags.string, tags.number], color: "#047857" },
  { tag: tags.atom, color: "#be185d" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px", backgroundColor: "var(--surface)", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.65" },
  ".cm-content": { padding: "12px 0" },
  ".cm-gutters": { backgroundColor: "var(--surface)", color: "var(--muted)", border: "none", paddingLeft: "4px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--primary) 4%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--primary) 18%, transparent) !important" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-ySelectionInfo": { fontFamily: "var(--app-font)", fontSize: "11px", padding: "1px 4px", borderRadius: "4px", opacity: "1" },
});

const editability = (editable: boolean) => [EditorView.editable.of(editable), EditorState.readOnly.of(!editable)];

export function LatexEditor({ session, editable, onView }: { session: CollabSession; editable: boolean; onView?: (view: EditorView | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editableConf = useRef(new Compartment());
  const onViewRef = useRef(onView);
  const editableRef = useRef(editable);
  useEffect(() => {
    onViewRef.current = onView;
    editableRef.current = editable;
  });

  useEffect(() => {
    if (!host.current) return;
    const ytext = session.ydoc.getText(LATEX_FIELD);
    const undoManager = new Y.UndoManager(ytext);
    session.provider.setAwarenessField("user", { ...session.user, colorLight: `${session.user.color}33` });
    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        EditorView.lineWrapping,
        StreamLanguage.define(stex),
        syntaxHighlighting(highlight),
        keymap.of([...yUndoManagerKeymap, indentWithTab, ...defaultKeymap]),
        yCollab(ytext, session.provider.awareness, { undoManager }),
        editableConf.current.of(editability(editableRef.current)),
        EditorView.contentAttributes.of({ "aria-label": "Mã nguồn LaTeX", spellcheck: "false" }),
        theme,
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    onViewRef.current?.(v);
    return () => {
      onViewRef.current?.(null);
      v.destroy();
      undoManager.destroy();
      view.current = null;
    };
  }, [session]);

  useEffect(() => {
    view.current?.dispatch({ effects: editableConf.current.reconfigure(editability(editable)) });
  }, [editable]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}

export function jumpToLine(view: EditorView | null, line: number) {
  if (!view || line < 1) return;
  const target = view.state.doc.line(Math.min(line, view.state.doc.lines));
  view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) });
  view.focus();
}
