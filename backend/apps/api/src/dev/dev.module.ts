import { Module } from '@nestjs/common';
import { DevAuthController } from './dev-auth.controller.js';
import { DevLoginController } from './dev-login.controller.js';

/** Công cụ chỉ dành cho môi trường development (AppModule chỉ nạp khi NODE_ENV=development). */
@Module({ controllers: [DevLoginController, DevAuthController] })
export class DevModule {}
