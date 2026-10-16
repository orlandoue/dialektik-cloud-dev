import { llmSemanticContractV2Migration } from './024_llm_semantic_contract_v2';
import { cloudflareProjectionRouteGrantMigration } from './025_cloudflare_projection_route_grants';
import { titleOnlyProjectionShadowMigration } from './026_title_only_projection_shadow';
import { officialApiHashOnlyTitleRegistrationMigration } from './027_official_api_hash_only_title_registration';
import { titleOnlyExternalAuthorizationMigration } from './028_title_only_external_authorization';
import { llmSemanticShadowMigration } from './023_llm_semantic_shadow';
import { personalOwnerAuditMigration } from './029_personal_owner_audit';
import { personalOwnerTestWorkflowMigration } from './030_personal_owner_test_workflow';
import { titleOnlyTimestampPrecisionMigration } from './031_title_only_timestamp_precision';
import { personalOwnerDurableJobsMigration } from './032_personal_owner_durable_jobs';
import { personalOwnerOperationalPipelineMigration } from './033_personal_owner_operational_pipeline';
import type { Migration, MigrationProvider } from 'kysely';

import { initialSchemaMigration } from './001_initial_schema';
import { phase1bPersistenceHardeningMigration } from './002_phase_1b_persistence_hardening';
import { phase1cClosureMigration } from './003_phase_1c_closure';
import { phase2IngestionMigration } from './004_phase_2_ingestion';
import { phase3SemanticIntelligenceMigration } from './005_phase_3_semantic_intelligence';
import { phase3aSemanticHardeningMigration } from './006_phase_3a_semantic_hardening';
import { phase4AssertionExtractionMigration } from './007_phase_4_assertion_extraction';
import { phase4aUnicodeOffsetAuthorityMigration } from './008_phase_4a_unicode_offset_authority';
import { phase5AssertionSimilarityMigration } from './009_phase_5_assertion_similarity';
import { phase6ModerationSafetyMigration } from './010_phase_6_moderation_safety';
import { phase6SnapshotReparentHardeningMigration } from './011_phase_6_snapshot_reparent_hardening';
import { phase6ModerationAuthorityMigration } from './012_phase_6_moderation_authority';
import { phase6AuthorityHardeningMigration } from './013_phase_6_authority_hardening';
import { phase7PublicReadIndexesMigration } from './014_phase_7_public_read_indexes';
import { productSemanticShadowMigration } from './015_product_semantic_shadow';
import { semanticShadowHardeningMigration } from './016_semantic_shadow_hardening';
import { productLiveShadowMigration } from './017_product_live_shadow';
import { ephemeralSemanticPipelineMigration } from './018_ephemeral_semantic_pipeline';
import { ephemeralShadowGraphHardeningMigration } from './019_ephemeral_shadow_graph_hardening';
import { nativeDiagnosticReceiptsMigration } from './020_native_diagnostic_receipts';
import { acquisitionPacingMigration } from './021_acquisition_pacing';
import { prospectiveMultisourceShadowMigration } from './022_prospective_multisource_shadow';
import { personalOwnerConnectedPipelineMigration } from './034_personal_owner_connected_pipeline';
import { personalOwnerWorkersFreeNeuronBudgetMigration } from './035_personal_owner_workers_free_neuron_budget';
import { personalOwnerAdaptiveFeedPollingMigration } from './036_personal_owner_adaptive_feed_polling';
import { seedProspectiveRightsGuardForNewSourcesMigration } from './037_seed_prospective_rights_guard_for_new_sources';
import { personalOwnerOfficialVoteEventsMigration } from './038_personal_owner_official_vote_events';
import { privateBetaAccessMigration } from './039_private_beta_access';
import { liveCoreColumnReadMigration } from './040_live_core_column_read';
import { govUkProductMetadataWriterMigration } from './041_govuk_product_metadata_writer';

const migrations: Readonly<Record<string, Migration>> = {
  '023_llm_semantic_shadow': llmSemanticShadowMigration,
  '024_llm_semantic_contract_v2': llmSemanticContractV2Migration,
  '025_cloudflare_projection_route_grants': cloudflareProjectionRouteGrantMigration,
  '026_title_only_projection_shadow': titleOnlyProjectionShadowMigration,
  '027_official_api_hash_only_title_registration': officialApiHashOnlyTitleRegistrationMigration,
  '028_title_only_external_authorization': titleOnlyExternalAuthorizationMigration,
  '029_personal_owner_audit': personalOwnerAuditMigration,
  '030_personal_owner_test_workflow': personalOwnerTestWorkflowMigration,
  '031_title_only_timestamp_precision': titleOnlyTimestampPrecisionMigration,
  '032_personal_owner_durable_jobs': personalOwnerDurableJobsMigration,
  '033_personal_owner_operational_pipeline': personalOwnerOperationalPipelineMigration,
  '034_personal_owner_connected_pipeline': personalOwnerConnectedPipelineMigration,
  '035_personal_owner_workers_free_neuron_budget': personalOwnerWorkersFreeNeuronBudgetMigration,
  '036_personal_owner_adaptive_feed_polling': personalOwnerAdaptiveFeedPollingMigration,
  '037_seed_prospective_rights_guard_for_new_sources':
    seedProspectiveRightsGuardForNewSourcesMigration,
  '038_personal_owner_official_vote_events': personalOwnerOfficialVoteEventsMigration,
  '039_private_beta_access': privateBetaAccessMigration,
  '040_live_core_column_read': liveCoreColumnReadMigration,
  '041_govuk_product_metadata_writer': govUkProductMetadataWriterMigration,
  '001_initial_schema': initialSchemaMigration,
  '002_phase_1b_persistence_hardening': phase1bPersistenceHardeningMigration,
  '003_phase_1c_closure': phase1cClosureMigration,
  '004_phase_2_ingestion': phase2IngestionMigration,
  '005_phase_3_semantic_intelligence': phase3SemanticIntelligenceMigration,
  '006_phase_3a_semantic_hardening': phase3aSemanticHardeningMigration,
  '007_phase_4_assertion_extraction': phase4AssertionExtractionMigration,
  '008_phase_4a_unicode_offset_authority': phase4aUnicodeOffsetAuthorityMigration,
  '009_phase_5_assertion_similarity': phase5AssertionSimilarityMigration,
  '010_phase_6_moderation_safety': phase6ModerationSafetyMigration,
  '011_phase_6_snapshot_reparent_hardening': phase6SnapshotReparentHardeningMigration,
  '012_phase_6_moderation_authority': phase6ModerationAuthorityMigration,
  '013_phase_6_authority_hardening': phase6AuthorityHardeningMigration,
  '014_phase_7_public_read_indexes': phase7PublicReadIndexesMigration,
  '015_product_semantic_shadow': productSemanticShadowMigration,
  '016_semantic_shadow_hardening': semanticShadowHardeningMigration,
  '017_product_live_shadow': productLiveShadowMigration,
  '018_ephemeral_semantic_pipeline': ephemeralSemanticPipelineMigration,
  '019_ephemeral_shadow_graph_hardening': ephemeralShadowGraphHardeningMigration,
  '020_native_diagnostic_receipts': nativeDiagnosticReceiptsMigration,
  '021_acquisition_pacing': acquisitionPacingMigration,
  '022_prospective_multisource_shadow': prospectiveMultisourceShadowMigration,
};

export class DialektikMigrationProvider implements MigrationProvider {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ ...migrations });
  }
}
