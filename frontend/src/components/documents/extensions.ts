import { Mark, mergeAttributes, type Extensions } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";
import { ImageView } from "./image-view";

export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",
  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-thread-id"),
        renderHTML: (attrs) => (attrs.threadId ? { "data-thread-id": attrs.threadId } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-thread-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "luna-comment" }, HTMLAttributes), 0];
  },
});

export const LunaImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-asset-id"),
        renderHTML: (attrs) => (attrs.assetId ? { "data-asset-id": attrs.assetId } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

export function buildExtensions({ ydoc, provider, user }: { ydoc: Y.Doc; provider: HocuspocusProvider; user: { name: string; color: string } }): Extensions {
  return [
    StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    LunaImage,
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    CommentMark,
    Placeholder.configure({ placeholder: "Bắt đầu viết…" }),
    Collaboration.configure({ document: ydoc, field: "default" }),
    CollaborationCaret.configure({ provider, user }),
  ];
}
