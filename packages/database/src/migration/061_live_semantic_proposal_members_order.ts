import { sql, type Migration } from "kysely";
import { liveSemanticEditorialPromotionDdl } from "./060_live_semantic_editorial_promotion.js";

export const liveSemanticProposalMembersOrderMigration: Migration = {
  async up(database): Promise<void> {
    await sql.raw(liveSemanticEditorialPromotionDdl).execute(database);
  },
  async down(): Promise<void> {
    throw new Error("Live semantic editorial promotion rules are forward-only.");
  },
};
