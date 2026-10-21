"use client";

import { type Editor, useEditorState } from "@tiptap/react";
import {
  Bold,
  ChevronDown,
  Code2,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  MessageSquarePlus,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { MenuItem } from "../ui/popover";
import { AnchoredPanel, useAnchored } from "./anchored";

const BLOCKS = [
  { value: "p", label: "Văn bản" },
  { value: "h1", label: "Tiêu đề 1" },
  { value: "h2", label: "Tiêu đề 2" },
  { value: "h3", label: "Tiêu đề 3" },
] as const;

export const HIGHLIGHTS = [
  { label: "Vàng", value: "#fef08a" },
  { label: "Xanh lá", value: "#bbf7d0" },
  { label: "Xanh dương", value: "#bfdbfe" },
  { label: "Hồng", value: "#fbcfe8" },
];
export const TEXT_COLORS = [
  { label: "Đỏ", value: "#dc2626" },
  { label: "Cam", value: "#c2410c" },
  { label: "Xanh lá", value: "#15803d" },
  { label: "Xanh dương", value: "#1d4ed8" },
  { label: "Tím", value: "#7e22ce" },
];

export function ToolButton({ icon: Icon, label, active, disabled, onClick, shortcut }: { icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; onClick: () => void; shortcut?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} · ${shortcut}` : label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground/70 outline-hidden transition-colors hover:bg-foreground/8 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-foreground/8 text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-border-strong" aria-hidden />;

function ColorMenu({ editor }: { editor: Editor }) {
  const { open, setOpen, toggle, anchorRef, panelRef } = useAnchored();
  const state = useEditorState({ editor, selector: ({ editor: e }) => ({ highlight: e.isActive("highlight"), color: (e.getAttributes("textStyle").color as string | undefined) ?? null }) });
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="Màu chữ và tô nền"
        title="Màu chữ và tô nền"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        className={cn("inline-flex h-8 shrink-0 cursor-pointer items-center gap-0.5 rounded-lg px-1.5 text-foreground/70 outline-hidden hover:bg-foreground/8 hover:text-foreground aria-expanded:bg-foreground/8", (state.highlight || state.color) && "text-foreground")}
      >
        <Highlighter className="size-4" aria-hidden />
        <ChevronDown className="size-3" aria-hidden />
      </button>
      <AnchoredPanel open={open} anchorRef={anchorRef} panelRef={panelRef} className="w-60 p-3">
        <p className="text-xs font-medium text-muted">Màu chữ</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Swatch label="Mặc định" onPick={() => editor.chain().focus().unsetColor().run()} active={!state.color} />
          {TEXT_COLORS.map((c) => (
            <Swatch key={c.value} label={c.label} text={c.value} active={state.color === c.value} onPick={() => editor.chain().focus().setColor(c.value).run()} />
          ))}
        </div>
        <p className="mt-3 text-xs font-medium text-muted">Tô nền</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Swatch label="Không tô" onPick={() => editor.chain().focus().unsetHighlight().run()} active={!state.highlight} />
          {HIGHLIGHTS.map((c) => (
            <Swatch key={c.value} label={c.label} bg={c.value} active={editor.isActive("highlight", { color: c.value })} onPick={() => { editor.chain().focus().setHighlight({ color: c.value }).run(); setOpen(false); }} />
          ))}
        </div>
      </AnchoredPanel>
    </>
  );
}

function Swatch({ label, text, bg, active, onPick }: { label: string; text?: string; bg?: string; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={cn("inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold outline-hidden", active ? "border-foreground" : "border-border-strong hover:border-foreground/40")}
      style={{ background: bg ?? "var(--surface)", color: text ?? "var(--foreground)" }}
    >
      A
    </button>
  );
}

function BlockSelect({ editor }: { editor: Editor }) {
  const { open, setOpen, toggle, anchorRef, panelRef } = useAnchored();
  const current = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p"),
  });
  const pick = (v: (typeof BLOCKS)[number]["value"]) => {
    const chain = editor.chain().focus();
    if (v === "p") chain.setParagraph().run();
    else chain.setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
    setOpen(false);
  };
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="Kiểu đoạn"
        aria-expanded={open}
        aria-haspopup="listbox"
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        className="inline-flex h-8 w-28 shrink-0 cursor-pointer items-center justify-between gap-1 rounded-lg px-2 text-sm text-foreground outline-hidden hover:bg-foreground/8 aria-expanded:bg-foreground/8"
      >
        {BLOCKS.find((b) => b.value === current)?.label}
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </button>
      <AnchoredPanel open={open} anchorRef={anchorRef} panelRef={panelRef} className="w-44">
        <div role="listbox" aria-label="Kiểu đoạn" className="px-1">
          {BLOCKS.map((b) => (
            <MenuItem key={b.value} role="option" aria-selected={b.value === current} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(b.value)} className={cn(b.value === current && "font-medium")}>
              <span className={cn(b.value === "h1" && "text-lg font-semibold", b.value === "h2" && "text-base font-semibold", b.value === "h3" && "font-semibold")}>{b.label}</span>
            </MenuItem>
          ))}
        </div>
      </AnchoredPanel>
    </>
  );
}

export function EditorToolbar({ editor, onLink, onImage, onComment, canComment }: { editor: Editor; onLink: () => void; onImage: () => void; onComment: () => void; canComment: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      link: e.isActive("link"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      code: e.isActive("codeBlock"),
      table: e.isActive("table"),
      empty: e.state.selection.empty,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => fn(editor.chain().focus()).run();
  return (
    <div role="toolbar" aria-label="Định dạng" className="scrollbar-clean flex items-center gap-0.5 overflow-x-auto">
      <ToolButton icon={Undo2} label="Hoàn tác" shortcut="Ctrl+Z" disabled={!s.canUndo} onClick={() => run((c) => c.undo())} />
      <ToolButton icon={Redo2} label="Làm lại" shortcut="Ctrl+Shift+Z" disabled={!s.canRedo} onClick={() => run((c) => c.redo())} />
      <Divider />
      <BlockSelect editor={editor} />
      <Divider />
      <ToolButton icon={Bold} label="In đậm" shortcut="Ctrl+B" active={s.bold} onClick={() => run((c) => c.toggleBold())} />
      <ToolButton icon={Italic} label="In nghiêng" shortcut="Ctrl+I" active={s.italic} onClick={() => run((c) => c.toggleItalic())} />
      <ToolButton icon={Underline} label="Gạch chân" shortcut="Ctrl+U" active={s.underline} onClick={() => run((c) => c.toggleUnderline())} />
      <ToolButton icon={Strikethrough} label="Gạch ngang" active={s.strike} onClick={() => run((c) => c.toggleStrike())} />
      <ColorMenu editor={editor} />
      <ToolButton icon={Link2} label="Chèn link" shortcut="Ctrl+K" active={s.link} onClick={onLink} />
      <Divider />
      <ToolButton icon={List} label="Danh sách chấm" active={s.bullet} onClick={() => run((c) => c.toggleBulletList())} />
      <ToolButton icon={ListOrdered} label="Danh sách số" active={s.ordered} onClick={() => run((c) => c.toggleOrderedList())} />
      <ToolButton icon={ListChecks} label="Danh sách việc" active={s.task} onClick={() => run((c) => c.toggleTaskList())} />
      <ToolButton icon={Quote} label="Trích dẫn" active={s.quote} onClick={() => run((c) => c.toggleBlockquote())} />
      <ToolButton icon={Code2} label="Khối code" active={s.code} onClick={() => run((c) => c.toggleCodeBlock())} />
      <ToolButton icon={Table2} label="Chèn bảng" active={s.table} onClick={() => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))} />
      <ToolButton icon={ImagePlus} label="Chèn ảnh" onClick={onImage} />
      {canComment ? (
        <>
          <Divider />
          <ToolButton icon={MessageSquarePlus} label="Thêm bình luận" shortcut="Ctrl+Alt+M" disabled={s.empty} onClick={onComment} />
        </>
      ) : null}
    </div>
  );
}
