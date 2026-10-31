"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { EmptyState } from "../ui/misc";

interface Heading {
  pos: number;
  level: number;
  text: string;
}

const INDENT: Record<number, string> = { 1: "pl-2", 2: "pl-5", 3: "pl-8" };

function readHeadings(editor: Editor | null) {
  const list: Heading[] = [];
  editor?.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = Number(node.attrs.level);
      const text = node.textContent.trim();
      if (level <= 3 && text) list.push({ pos, level, text });
      return false;
    }
    return node.isBlock && !node.isTextblock;
  });
  return list;
}

function same(a: Heading[], b: Heading[]) {
  return a.length === b.length && a.every((h, i) => h.pos === b[i]!.pos && h.level === b[i]!.level && h.text === b[i]!.text);
}

export function DocOutline({ editor, onNavigate }: { editor: Editor | null; onNavigate?: () => void }) {
  const [state, setState] = useState<{ editor: Editor | null; list: Heading[] }>({ editor: null, list: [] });
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const list = readHeadings(editor);
      setState((prev) => (prev.editor === editor && same(prev.list, list) ? prev : { editor, list }));
    };
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 150);
    };
    timer = setTimeout(refresh, 0);
    editor.on("transaction", onTransaction);
    return () => {
      clearTimeout(timer);
      editor.off("transaction", onTransaction);
    };
  }, [editor]);
  const headings = state.editor === editor ? state.list : [];

  if (!headings.length) return <EmptyState text="Tài liệu chưa có tiêu đề mục" />;

  const go = (pos: number) => {
    if (!editor) return;
    onNavigate?.();
    editor.commands.setTextSelection(pos + 1);
    const el = editor.view.nodeDOM(pos);
    if (el instanceof HTMLElement) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav aria-label="Mục lục">
      <ul className="flex flex-col gap-0.5">
        {headings.map((h) => (
          <li key={h.pos}>
            <button
              type="button"
              onClick={() => go(h.pos)}
              className={cn(
                "flex min-h-8 w-full cursor-pointer items-center rounded-lg pr-2 text-left text-sm outline-hidden transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:bg-foreground/5",
                INDENT[h.level],
                h.level === 1 ? "font-medium text-foreground" : "text-foreground/70",
              )}
            >
              <span className="truncate">{h.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
