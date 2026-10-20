import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:isPublic';

/** Bỏ qua AuthGuard (mặc định mọi route đều yêu cầu đăng nhập). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
