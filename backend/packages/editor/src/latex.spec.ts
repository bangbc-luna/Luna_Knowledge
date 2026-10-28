import * as Y from 'yjs';
import {
  jsonToHTML,
  jsonToMarkdown,
  jsonToState,
  jsonToText,
  replaceContent,
  stateToJSON,
} from './convert.js';
import { LATEX_TEMPLATE, latexJSON, latexToText } from './latex.js';

describe('Tài liệu LaTeX', () => {
  it('state Yjs giữ nguyên mã nguồn và tự nhận là LaTeX', () => {
    const json = latexJSON(LATEX_TEMPLATE);
    expect(stateToJSON(jsonToState(json))).toEqual(json);
  });

  it('chữ để tìm kiếm bỏ lệnh, chú thích, phần mở đầu', () => {
    const text = latexToText(String.raw`\documentclass{article}
\usepackage[utf8]{inputenc}
% ghi chú riêng
\section{Giới thiệu}
Doanh thu \textbf{quý 3} tăng 20\% so với $x^2$.
\begin{itemize}
  \item Mục một
\end{itemize}`);
    expect(text).toBe('Giới thiệu\nDoanh thu quý 3 tăng 20% so với x 2 .\n\nMục một');
    expect(jsonToText(latexJSON('\\section{A}'))).toBe('A');
  });

  it('xuất HTML và Markdown giữ mã nguồn, có escape', () => {
    const json = latexJSON('a < b \\& c');
    expect(jsonToHTML(json)).toBe('<pre>a &lt; b \\&amp; c</pre>');
    expect(jsonToMarkdown(json)).toBe('```latex\na < b \\& c\n```\n');
  });

  it('khôi phục phiên bản vào Y.Doc đang sống: client khác hội tụ, chỉ sửa đoạn khác', () => {
    const a = new Y.Doc();
    Y.applyUpdate(a, jsonToState(latexJSON('Đầu\nGiữa\nCuối')));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const updates: Uint8Array[] = [];
    a.on('update', (u: Uint8Array) => {
      updates.push(u);
      Y.applyUpdate(b, u);
    });
    replaceContent(a, latexJSON('Đầu\nMới\nCuối'));
    expect(stateToJSON(Y.encodeStateAsUpdate(b))).toEqual(latexJSON('Đầu\nMới\nCuối'));
    expect(updates).toHaveLength(1);
    replaceContent(a, latexJSON('Đầu\nMới\nCuối'));
    expect(updates).toHaveLength(1);
  });
});
