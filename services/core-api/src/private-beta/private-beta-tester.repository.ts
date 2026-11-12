import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';

import { CoreDatabaseService } from '../database/core-database.service.js';

@Injectable()
export class PrivateBetaTesterRepository {
  constructor(
    @Inject(CoreDatabaseService) private readonly databaseService: CoreDatabaseService,
  ) {}

  /**
   * `blocked` means the owner disabled or revoked this account explicitly;
   * `absent` means it has never been listed.
   */
  async testerStatus(userId: string): Promise<'enabled' | 'blocked' | 'absent'> {
    const result = await sql<{ readonly enabled: boolean; readonly revoked: boolean }>`
      select enabled, revoked_at is not null as revoked
      from public.private_beta_testers where user_id = ${userId}::uuid
    `.execute(this.databaseService.database);
    const row = result.rows[0];
    if (row === undefined) return 'absent';
    return row.enabled === true && row.revoked !== true ? 'enabled' : 'blocked';
  }

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
