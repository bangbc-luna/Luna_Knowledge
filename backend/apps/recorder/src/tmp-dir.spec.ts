import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearDirectory } from './tmp-dir.js';

describe('clearDirectory', () => {
  it('xoá hết nội dung nhưng giữ thư mục, tạo nếu chưa có', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'luna-clear-'));
    writeFileSync(join(dir, 'a.ogg'), 'x');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b.ogg'), 'x');
    await clearDirectory(dir);
    expect(readdirSync(dir)).toEqual([]);
    await clearDirectory(join(dir, 'missing'));
    expect(readdirSync(join(dir, 'missing'))).toEqual([]);
  });
});
