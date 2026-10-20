import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes.js';

/** Lỗi nghiệp vụ: service ném AppError, filter chuyển thành response chuẩn. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(message: string, details?: unknown) {
    return new AppError(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST, details);
  }

  static unauthenticated(message = 'Authentication required') {
    return new AppError(ErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }

  static sessionExpired(reason: string) {
    return new AppError(
      ErrorCode.SESSION_EXPIRED,
      'Session expired, please sign in again',
      HttpStatus.UNAUTHORIZED,
      { reason },
    );
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  /** Dùng cả khi user không có quyền xem, để không lộ sự tồn tại của tài nguyên. */
  static notFound(message = 'Resource not found') {
    return new AppError(ErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
  }

  static conflict(message: string, details?: unknown) {
    return new AppError(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT, details);
  }

  static tooLarge(message: string, details?: unknown) {
    return new AppError(ErrorCode.TOO_LARGE, message, HttpStatus.PAYLOAD_TOO_LARGE, details);
  }

  static unsupportedType(message: string, details?: unknown) {
    return new AppError(
      ErrorCode.UNSUPPORTED_TYPE,
      message,
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      details,
    );
  }

  static unavailable(message: string) {
    return new AppError(ErrorCode.SERVICE_UNAVAILABLE, message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
