import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:isPublic';

export const Public = () => SetMetadata(IS_PUBLIC, true);
