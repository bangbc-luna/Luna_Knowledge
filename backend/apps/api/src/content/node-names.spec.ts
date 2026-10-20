import { nameKey, nodeNameSchema, suggestName } from './node-names.js';

describe('node names', () => {
  it('chuẩn hóa NFC và khoảng trắng; so trùng không phân biệt hoa thường', () => {
    const composed = 'Báo cáo';
    const decomposed = 'Báo cáo';
    expect(nodeNameSchema.parse(`  ${decomposed}   Q1 `)).toBe(`${composed} Q1`);
    expect(nameKey('BÁO CÁO')).toBe(nameKey(decomposed));
  });

  it('từ chối tên rỗng, chứa / \\ hoặc ký tự điều khiển, "." và ".."', () => {
    for (const bad of ['', '   ', 'a/b', 'a\\b', 'a\u0007', '.', '..']) {
      expect(nodeNameSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('gợi ý tên mới, giữ đuôi file', () => {
    const taken = new Set(['báo cáo', 'báo cáo (1)', 'report.pdf'].map(nameKey));
    expect(suggestName('Báo cáo', taken)).toBe('Báo cáo (2)');
    expect(suggestName('Báo cáo (1)', taken)).toBe('Báo cáo (2)');
    expect(suggestName('report.pdf', taken)).toBe('report (1).pdf');
    expect(suggestName('.env', new Set())).toBe('.env (1)');
  });
});
