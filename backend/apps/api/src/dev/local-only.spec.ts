import type { Request } from 'express';
import { isLocalRequest } from './local-only.js';

const req = (remoteAddress: string, headers: Record<string, string> = {}) =>
  ({ socket: { remoteAddress }, headers }) as unknown as Request;

describe('isLocalRequest', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('cho phép kết nối thẳng từ %s', (ip) => {
    expect(isLocalRequest(req(ip))).toBe(true);
  });

  it('từ chối máy khác trong mạng', () => {
    expect(isLocalRequest(req('192.168.28.50'))).toBe(false);
    expect(isLocalRequest(req('::ffff:192.168.28.50'))).toBe(false);
  });

  it.each([
    ['x-forwarded-for', '127.0.0.1'],
    ['x-forwarded-host', 'localhost:5173'],
    ['forwarded', 'for=127.0.0.1'],
  ])('từ chối yêu cầu đi qua proxy (%s), kể cả khi header ghi là máy này', (name, value) => {
    expect(isLocalRequest(req('127.0.0.1', { [name]: value }))).toBe(false);
  });
});
