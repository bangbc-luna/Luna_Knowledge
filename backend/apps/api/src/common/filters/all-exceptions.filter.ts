import { reportError } from '@luna/shared';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { ErrorCode, STATUS_TO_CODE } from '../errors/error-codes.js';
import { isInfrastructureError } from '../errors/infra-errors.js';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const { status, body } = this.toResponse(exception);
    body.error.requestId = req.id;

    if (status === HttpStatus.SERVICE_UNAVAILABLE && isInfrastructureError(exception)) {
      this.logger.error(
        { err: exception, requestId: req.id },
        'Dependency unavailable (Postgres/Redis/S3). Is the infrastructure running? Try `pnpm infra:up`',
      );
    } else if (status >= 500) {
      this.logger.error({ err: exception, requestId: req.id }, 'Unhandled error');
      reportError(exception, { requestId: req.id, path: req.path });
    }
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: {
          error: { code: exception.code, message: exception.message, details: exception.details },
        },
      };
    }
    const parserStatus = bodyParserStatus(exception);
    if (parserStatus) {
      return {
        status: parserStatus,
        body: {
          error: {
            code: STATUS_TO_CODE[parserStatus] ?? 'HTTP_ERROR',
            message:
              parserStatus === HttpStatus.PAYLOAD_TOO_LARGE
                ? 'Request body is too large'
                : 'Malformed request body',
          },
        },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : String((response as { message?: unknown }).message ?? exception.message);
      const details =
        typeof response === 'object' && response !== null && 'details' in response
          ? (response as { details: unknown }).details
          : undefined;
      return {
        status,
        body: {
          error: {
            code:
              STATUS_TO_CODE[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : 'HTTP_ERROR'),
            message,
            details,
          },
        },
      };
    }
    if (isInfrastructureError(exception)) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        body: {
          error: {
            code: ErrorCode.SERVICE_UNAVAILABLE,
            message: 'A backend service is temporarily unavailable, please retry later',
          },
        },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' } },
    };
  }
}

function bodyParserStatus(e: unknown): number | null {
  if (typeof e !== 'object' || e === null || !('type' in e)) return null;
  const { type, status } = e as { type?: unknown; status?: unknown };
  if (typeof type !== 'string' || !type.startsWith('entity.')) return null;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}
