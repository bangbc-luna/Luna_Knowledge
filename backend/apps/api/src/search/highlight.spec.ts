import { foldVietnamese } from '@luna/shared';
import { snippetAround, splitMatches } from './highlight.js';

const at = (ascii: string, word: string) => [{ start: ascii.indexOf(word), length: word.length }];

describe('highlight', () => {
  it('vị trí khớp trên bản không dấu tô đúng chữ có dấu', () => {
    const name = 'Báo cáo tháng 10';
    const ascii = foldVietnamese(name);
    expect(splitMatches([...name], at(ascii, 'bao cao'.replace('b', 'B')))).toEqual([
      { text: 'Báo cáo', match: true },
      { text: ' tháng 10', match: false },
    ]);
  });

  it('đoạn trích có dấu … khi cắt giữa văn bản', () => {
    const text = `${'Mở đầu '.repeat(40)}Quy trình đề xuất ngân sách ${'kết thúc '.repeat(40)}`;
    const ascii = foldVietnamese(text);
    const parts = snippetAround([...text], at(ascii, 'de xuat'))!;
    expect(parts[0]!.text).toBe('…');
    expect(parts.at(-1)!.text).toBe('…');
    expect(parts.find((p) => p.match)!.text).toBe('đề xuất');
  });
});
