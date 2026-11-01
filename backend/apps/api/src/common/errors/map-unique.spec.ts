import { Prisma } from '@luna/db';
import { mapUnique } from './map-unique.js';

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7' });

describe('mapUnique', () => {
  it('maps P2002 to a 409 with the given message', async () => {
    await expect(mapUnique(() => Promise.reject(p2002()), 'Taken')).rejects.toMatchObject({
      status: 409,
      message: 'Taken',
    });
  });

  it('rethrows other errors as the same instance', async () => {
    const e = new Error('x');
    await expect(mapUnique(() => Promise.reject(e), 'T')).rejects.toBe(e);
  });

  it('rethrows other Prisma codes untouched', async () => {
    const e = new Prisma.PrismaClientKnownRequestError('nf', {
      code: 'P2025',
      clientVersion: '7',
    });
    await expect(mapUnique(() => Promise.reject(e), 'T')).rejects.toBe(e);
  });

  it('returns the value on success', async () => {
    await expect(mapUnique(async () => 7, 'T')).resolves.toBe(7);
  });
});
