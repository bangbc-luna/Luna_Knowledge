import { corsOrigins } from './cors-origins.js';

describe('corsOrigins', () => {
  it('development: thêm bản 127.0.0.1 và localhost cho cùng port', () => {
    expect(corsOrigins(['http://localhost:5173'], 'development')).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    expect(corsOrigins(['http://127.0.0.1:5173'], 'development')).toEqual([
      'http://127.0.0.1:5173',
      'http://localhost:5173',
    ]);
  });

  it('development: giữ nguyên origin không phải loopback', () => {
    expect(corsOrigins(['https://kb.lunatech.vn'], 'development')).toEqual([
      'https://kb.lunatech.vn',
    ]);
  });

  it('production: không thêm origin nào', () => {
    expect(corsOrigins(['http://localhost:5173'], 'production')).toEqual(['http://localhost:5173']);
  });
});
