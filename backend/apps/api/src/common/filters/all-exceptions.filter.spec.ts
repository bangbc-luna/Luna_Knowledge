import { type ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function mockHost() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'req-1' }) }),
  } as unknown as ArgumentsHost;
  return { res, host };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('chuyển AppError thành response chuẩn', () => {
    const { res, host } = mockHost();
    filter.catch(AppError.conflict('Name taken', { suggestion: 'a (1)' }), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'CONFLICT',
        message: 'Name taken',
        details: { suggestion: 'a (1)' },
        requestId: 'req-1',
      },
    });
  });

  it('ánh xạ HttpException của Nest sang mã lỗi', () => {
    const { res, host } = mockHost();
    filter.catch(new BadRequestException('bad'), host);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'bad',
    });
  });

  it('lỗi mất kết nối DB/Redis trả 503 thay vì 500', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const prismaDown = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    const redisDown = Object.assign(new Error('Reached the max retries per request limit'), {
      name: 'MaxRetriesPerRequestError',
    });
    const wrapped = new Error('outer', {
      cause: new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })]),
    });
    for (const err of [prismaDown, redisDown, wrapped]) {
      const { res, host } = mockHost();
      filter.catch(err, host);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json.mock.calls[0][0].error.code).toBe('SERVICE_UNAVAILABLE');
    }
  });

  it('ẩn chi tiết lỗi không xác định', () => {
    const { res, host } = mockHost();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    filter.catch(new Error('db password is hunter2'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId: 'req-1',
    });
  });
});
