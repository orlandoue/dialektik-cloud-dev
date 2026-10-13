import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';

@Injectable()
export class PrivateBetaTesterRepository {
  constructor(
    @Inject(CoreDatabaseService) private readonly databaseService: CoreDatabaseService,
  ) {}

  async isEnabledTester(userId: string): Promise<boolean> {
    const result = await sql<{ readonly allowed: boolean }>`
      select exists (
        select 1 from public.private_beta_testers
        where user_id = ${userId}::uuid
          and enabled is true
          and revoked_at is null
      ) as allowed
    `.execute(this.databaseService.database);
    return result.rows[0]?.allowed === true;
  }
}
