"use client";

import "katex/dist/katex.min.css";
import type { EditorView } from "@codemirror/view";
import { CircleAlert, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { LATEX_FIELD } from "@/lib/latex";
import { type LatexWarning, renderLatex } from "@/lib/latex-render";
import { Card } from "../ui/misc";
import { jumpToLine, LatexEditor } from "./latex-editor";
import type { CollabSession } from "./use-collab";

export function LatexPreview({ source }: { source: string }) {
  const { body } = useMemo(() => renderLatex(source), [source]);
  return <div className="luna-prose latex-preview">{body}</div>;
}

function useLatexSource(session: CollabSession | null, initial: string) {
  const [source, setSource] = useState(initial);
  useEffect(() => {
    if (!session) return;
    const ytext = session.ydoc.getText(LATEX_FIELD);
    const update = () => setSource(ytext.toString());
    if (session.provider.isSynced) update();
    ytext.observe(update);
    session.provider.on("synced", update);
    return () => {
      ytext.unobserve(update);
      session.provider.off("synced", update);
    };
  }, [session]);
  return source;
}

function Warnings({ warnings, onJump }: { warnings: LatexWarning[]; onJump: (line: number) => void }) {
  if (!warnings.length) return null;
  return (
    <div role="status" className="max-h-36 shrink-0 overflow-y-auto border-t border-border-strong bg-warn-bg px-4 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
        <CircleAlert className="size-3.5" aria-hidden />
        {warnings.length} chỗ cần xem lại
      </p>
      <ul className="mt-1.5 space-y-1">
        {warnings.map((w, i) => (
          <li key={i} className="text-xs text-foreground">
            {w.line ? (
              <button type="button" onClick={() => onJump(w.line)} className="mr-1.5 cursor-pointer font-medium tabular-nums underline underline-offset-2 hover:text-primary">
                Dòng {w.line}
              </button>
            ) : null}
            <span className="[overflow-wrap:anywhere]">{w.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LatexWorkspace({ session, initialSource, editable, wide }: { session: CollabSession | null; initialSource: string; editable: boolean; wide: boolean }) {
  const source = useLatexSource(session, initialSource);
  const deferred = useDeferredValue(source);
  const rendered = useMemo(() => renderLatex(deferred), [deferred]);
  const [showPreview, setShowPreview] = useState(true);
  const view = useRef<EditorView | null>(null);

  const preview = <div className="luna-prose latex-preview">{rendered.body}</div>;

  if (!editable || !wide) {
    return (
      <div className="mx-auto mt-4 w-full max-w-[52rem]">
        {editable ? <p className="mb-3 text-sm text-pretty text-muted">Mở trên máy tính để sửa mã nguồn LaTeX.</p> : null}
        <Card className="px-5 py-8 sm:px-12 sm:py-10">{preview}</Card>
      </div>
    );
  }

  return (
    <div className={cn("mt-4 grid h-[calc(100dvh-13rem)] min-h-[28rem] gap-4", showPreview && "grid-cols-2")}>
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-strong pr-1.5 pl-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Mã nguồn</h2>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted outline-hidden hover:bg-foreground/5 hover:text-foreground"
          >
            {showPreview ? <PanelRightClose className="size-4" aria-hidden /> : <PanelRightOpen className="size-4" aria-hidden />}
            {showPreview ? "Ẩn xem trước" : "Hiện xem trước"}
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {session ? <LatexEditor session={session} editable={editable} onView={(v) => (view.current = v)} /> : <div className="h-full animate-pulse bg-foreground/5" aria-busy="true" aria-label="Đang tải" />}
        </div>
        <Warnings warnings={rendered.warnings} onJump={(line) => jumpToLine(view.current, line)} />
      </Card>
      {showPreview ? (
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex h-11 shrink-0 items-center border-b border-border-strong px-4">
            <h2 className="text-sm font-semibold">Xem trước</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">{preview}</div>
        </Card>
      ) : null}
    </div>
  );
}
