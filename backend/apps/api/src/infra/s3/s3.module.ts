import { ObjectStore } from '@luna/shared';
import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';

@Global()
@Module({
  providers: [
    {
      provide: ObjectStore,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => new ObjectStore(c),
    },
  ],
  exports: [ObjectStore],
})
export class S3Module implements OnModuleDestroy {
  constructor(private readonly store: ObjectStore) {}

  onModuleDestroy() {
    this.store.destroy();
  }
}
