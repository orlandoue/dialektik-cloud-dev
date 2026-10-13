import { Global, Module } from '@nestjs/common';

import { CoreDatabaseService } from './core-database.service.js';

@Global()
@Module({
  exports: [CoreDatabaseService],
  providers: [CoreDatabaseService],
})
export class CoreDatabaseModule {}
