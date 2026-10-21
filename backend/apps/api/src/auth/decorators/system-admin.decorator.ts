import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';

export const REQUIRE_SYSTEM_ADMIN = 'auth:requireSystemAdmin';

export const SystemAdmin = () =>
  applyDecorators(
    SetMetadata(REQUIRE_SYSTEM_ADMIN, true),
    ApiForbiddenResponse({ description: 'Chỉ System Admin' }),
  );
