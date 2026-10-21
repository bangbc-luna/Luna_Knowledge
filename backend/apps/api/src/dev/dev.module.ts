import { Module } from '@nestjs/common';
import { DevAuthController } from './dev-auth.controller.js';
import { DevLoginController } from './dev-login.controller.js';
import { DevPlayerController } from './dev-player.controller.js';

/** Công cụ chỉ dành cho môi trường development (AppModule chỉ nạp khi NODE_ENV=development). */
@Module({ controllers: [DevLoginController, DevAuthController, DevPlayerController] })
export class DevModule {}
