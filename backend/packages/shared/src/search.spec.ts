import { foldVietnamese } from './search.js';

describe('foldVietnamese', () => {
  it('bỏ dấu tiếng Việt, giữ nguyên số ký tự', () => {
    const s = 'Báo cáo Đề xuất người dùng';
    const f = foldVietnamese(s);
    expect(f).toBe('Bao cao De xuat nguoi dung');
    expect([...f].length).toBe([...s.normalize('NFC')].length);
  });

  it('chuỗi tổ hợp (NFD) cũng được chuẩn hoá; ký tự lạ thành khoảng trắng', () => {
    expect(foldVietnamese('Dự án')).toBe('Du an');
    expect(foldVietnamese('a😀b')).toBe('a b');
    expect([...foldVietnamese('Hội nghị — “Lunatech” ™')].every((c) => c.charCodeAt(0) < 128)).toBe(
      true,
    );
  });
});
