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

describe('matchPerson bổ sung', () => {
  it('không bỏ từ xưng hô trong tên ứng viên: "Chi Mai" không bị thành "mai"', () => {
    const list = [
      { id: 'a', name: 'Chi Mai', email: 'x@x.vn' },
      { id: 'b', name: 'Lê Mai', email: 'y@x.vn' },
    ];
    expect(matchPerson('Mai', list)).toBeNull();
    expect(matchPerson('Chi Mai', list)).toBe('a');
    expect(matchPerson('chị Mai', [{ id: 'a', name: 'Trần Mai', email: 'm@x.vn' }])).toBe('a');
  });

  it('loại các id cho trước khỏi ứng viên', () => {
    expect(matchPerson('Hùng', people, new Set(['a']))).toBeNull();
    expect(matchPerson('Hà', people, new Set(['a']))).toBe('b');
  });
});
