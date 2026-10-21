import { type Extensions, getSchema, Mark, mergeAttributes } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-thread-id'),
        renderHTML: (attrs) => (attrs.threadId ? { 'data-thread-id': attrs.threadId } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-thread-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'luna-comment' }, HTMLAttributes), 0];
  },
});

export const LunaImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-asset-id'),
        renderHTML: (attrs) => (attrs.assetId ? { 'data-asset-id': attrs.assetId } : {}),
      },
    };
  },
});

export const editorExtensions: Extensions = [
  StarterKit.configure({ undoRedo: false, link: { openOnClick: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit,
  LunaImage,
  Highlight.configure({ multicolor: true }),
  TextStyle,
  Color,
  CommentMark,
];

export const editorSchema = getSchema(editorExtensions);

export const YJS_FIELD = 'default';
