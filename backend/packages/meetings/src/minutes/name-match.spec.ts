import { foldName, matchPerson } from './name-match.js';

const people = [
  { id: 'a', name: 'Nguyễn Văn Hùng', email: 'hung.nv@x.vn' },
  { id: 'b', name: 'Trần Thu Hà', email: 'ha@x.vn' },
];

describe('matchPerson', () => {
  it('foldName bỏ dấu và từ xưng hô', () => {
    expect(foldName('  Anh  Đặng Hùng ')).toBe('dang hung');
    expect(foldName('a')).toBe('a');
  });

  it('khớp tên: "anh Hùng" khớp Nguyễn Văn Hùng duy nhất; "hung" không dấu vẫn khớp', () => {
    expect(matchPerson('anh Hùng', people)).toBe('a');
    expect(matchPerson('hung', people)).toBe('a');
    expect(matchPerson('nguyen van hung', people)).toBe('a');
    expect(matchPerson('Hà', people)).toBe('b');
    expect(matchPerson('Lan', people)).toBeNull();
  });

  it('tên trùng nhau giữa hai thành viên → không khớp', () => {
    const two = [...people, { id: 'c', name: 'Phạm Quốc Hùng', email: 'hungpq@x.vn' }];
    expect(matchPerson('Hùng', two)).toBeNull();
    expect(matchPerson('Phạm Quốc Hùng', two)).toBe('c');
  });

  it('khớp theo phần trước @ của email', () => {
    expect(matchPerson('hung.nv', people)).toBe('a');
  });
});
