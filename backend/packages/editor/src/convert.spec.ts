import * as Y from 'yjs';
import {
  htmlToJSON,
  jsonToHTML,
  jsonToMarkdown,
  jsonToState,
  jsonToText,
  replaceContent,
  stateToJSON,
  wordCount,
} from './convert.js';

const sample = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Quy trình onboarding' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Chào mừng ' },
        {
          type: 'text',
          text: 'thành viên mới',
          marks: [{ type: 'bold' }, { type: 'comment', attrs: { threadId: 't1' } }],
        },
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nhận laptop' }] }],
        },
      ],
    },
  ],
};

describe('editor convert', () => {
  it('JSON ↔ Yjs giữ nguyên nội dung, kể cả mark comment', () => {
    const back = stateToJSON(jsonToState(sample));
    expect(jsonToText(back)).toBe(jsonToText(sample));
    expect(JSON.stringify(back)).toContain('"threadId":"t1"');
  });

  it('HTML, chữ trơn, Markdown, đếm từ tiếng Việt', () => {
    expect(jsonToHTML(sample)).toContain('<h1>Quy trình onboarding</h1>');
    expect(jsonToHTML(sample)).toContain('data-thread-id="t1"');
    expect(jsonToText(sample)).toBe('Quy trình onboarding\nChào mừng thành viên mới\nNhận laptop');
    expect(jsonToMarkdown(sample)).toMatch(/^# Quy trình onboarding/);
    expect(wordCount('Chào mừng thành viên mới, 2026!')).toBe(6);
  });

  it('import HTML (từ docx) ra tài liệu hợp lệ; thẻ lạ bị bỏ', () => {
    const json = htmlToJSON(
      '<h2>Mục 1</h2><p>Đoạn <script>x</script><strong>đậm</strong></p><table><tr><td>A</td></tr></table>',
    );
    expect(jsonToText(json)).toContain('Mục 1');
    expect(JSON.stringify(json)).not.toContain('script');
    expect(JSON.stringify(json)).toContain('"type":"table"');
  });

  it('thay nội dung một Y.Doc đang sống: client khác hội tụ', () => {
    const a = new Y.Doc();
    Y.applyUpdate(a, jsonToState(sample));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
    replaceContent(a, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bản cũ' }] }],
    });
    expect(jsonToText(stateToJSON(Y.encodeStateAsUpdate(b)))).toBe('Bản cũ');
  });
});
