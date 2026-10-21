import { Module } from '@nestjs/common';
import { DevAuthController } from './dev-auth.controller.js';
import { DevLoginController } from './dev-login.controller.js';
import { DevPlayerController } from './dev-player.controller.js';

@Module({ controllers: [DevLoginController, DevAuthController, DevPlayerController] })
export class DevModule {}
