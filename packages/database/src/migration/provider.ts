import { synthesisRelationMigration } from './081_synthesis_relation.js';
import { socialCommunityMigration } from './083_social_community.js';
import { socialFollowerCountMigration } from './084_social_follower_count.js';
import { socialArenaMigration } from './085_social_arena.js';
import { semanticRunBatchSizeMigration } from './086_semantic_run_batch_size.js';
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
import { editorialBetaIdentityMigration } from './044_editorial_beta_identity';
import { singleEditorAuthorityMigration } from './045_single_editor_authority';
import { moderationWriterScopeMigration } from './046_moderation_writer_scope';
import { editorialEventSplitsMigration } from './047_editorial_event_splits';
import { headlineSemanticReviewMigration } from './048_headline_semantic_review';
import { headlineRejectionDiagnosticsMigration } from './049_headline_rejection_diagnostics';
import { headlineContextPairReviewMigration } from './050_headline_context_pair_review';
import { headlineContextModelRelationMigration } from './051_headline_context_model_relation';
import { liveNewsSitemapChannelMigration } from './052_live_news_sitemap_channel';
import { chileVerifiedMetadataRoutesMigration } from './053_chile_verified_metadata_routes';
import { chileFeedExcerptAndYoutubeSourcesMigration } from './054_chile_feed_excerpt_and_youtube_sources';
import { liveArticlesEventLinkCheckMigration } from './055_live_articles_event_link_check';
import { liveExcerptTextProjectionMigration } from './056_live_excerpt_text_projection';
import { enableExcerptSemanticGrantsAndLiveEventsMigration } from './057_enable_excerpt_semantic_grants_and_live_events';
import { excerptGovernanceAndProviderGrantsMigration } from './058_seed_excerpt_governance_and_provider_grants';
import { qualifyExtractionGenerationDigestMigration } from './059_qualify_extraction_generation_digest';
import { liveSemanticEditorialPromotionMigration } from './060_live_semantic_editorial_promotion';
import { liveSemanticProposalMembersOrderMigration } from './061_live_semantic_proposal_members_order';
import { finalizeLiveSemanticPromotionMigration } from './062_finalize_live_semantic_promotion';
import { skipUnconfirmedStalePublicationsMigration } from './063_skip_unconfirmed_stale_publications';
import { liveEventOriginMigration } from './064_live_event_origin';
import { liveSemanticGenerationLineageMigration } from './065_live_semantic_generation_lineage';
import { corporateLiveAcquisitionMigration } from './066_corporate_live_acquisition';
import { liveSemanticMultiClaimPositionsMigration } from './067_live_semantic_multi_claim_positions';
import { corporateLiveAcquisitionWriterMigration } from './068_corporate_live_acquisition_writer';
import { corporateLiveHashSchemaUsageMigration } from './069_corporate_live_hash_schema_usage';
import { corporateLiveQuarantineIdentityMigration } from './070_corporate_live_quarantine_identity';
import { restoreCorporateLiveApprovalMetadataMigration } from './071_restore_corporate_live_approval_metadata';
import { corporateLiveRightsGuardLockMigration } from './072_corporate_live_rights_guard_lock';
import { normalizeCorporateLiveRegistryKeysMigration } from './073_normalize_corporate_live_registry_keys';
import { qualifyEphemeralArticleGuardDigestMigration } from './074_qualify_ephemeral_article_guard_digest';
import { liveSemanticEditorialDecisionsMigration } from './075_live_semantic_editorial_decisions';
import { liveStanceReassessmentMigration } from './076_live_stance_reassessment';
import { liveSemanticEventAttachmentMigration } from './077_live_semantic_event_attachment';
import { editorialFocusContrastsMigration } from './078_editorial_focus_contrasts';
import { automaticFocusContrastsMigration } from './082_automatic_focus_contrasts';
import { youtubeVerifiedChannelIdsMigration } from './079_youtube_verified_channel_ids';
import { userFollowedSourcesMigration } from './080_user_followed_sources';

const migrations: Readonly<Record<string, Migration>> = {
  '086_semantic_run_batch_size': semanticRunBatchSizeMigration,
  '085_social_arena': socialArenaMigration,
  '084_social_follower_count': socialFollowerCountMigration,
  '083_social_community': socialCommunityMigration,
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
  '044_editorial_beta_identity': editorialBetaIdentityMigration,
  '045_single_editor_authority': singleEditorAuthorityMigration,
  '046_moderation_writer_scope': moderationWriterScopeMigration,
  '047_editorial_event_splits': editorialEventSplitsMigration,
  '048_headline_semantic_review': headlineSemanticReviewMigration,
  '049_headline_rejection_diagnostics': headlineRejectionDiagnosticsMigration,
  '050_headline_context_pair_review': headlineContextPairReviewMigration,
  '051_headline_context_model_relation': headlineContextModelRelationMigration,
  '052_live_news_sitemap_channel': liveNewsSitemapChannelMigration,
  '053_chile_verified_metadata_routes': chileVerifiedMetadataRoutesMigration,
  '054_chile_feed_excerpt_and_youtube_sources': chileFeedExcerptAndYoutubeSourcesMigration,
  '055_live_articles_event_link_check': liveArticlesEventLinkCheckMigration,
  '056_live_excerpt_text_projection': liveExcerptTextProjectionMigration,
  '057_enable_excerpt_semantic_grants_and_live_events': enableExcerptSemanticGrantsAndLiveEventsMigration,
  '058_seed_excerpt_governance_and_provider_grants': excerptGovernanceAndProviderGrantsMigration,
  '059_qualify_extraction_generation_digest': qualifyExtractionGenerationDigestMigration,
  '060_live_semantic_editorial_promotion': liveSemanticEditorialPromotionMigration,
  '061_live_semantic_proposal_members_order': liveSemanticProposalMembersOrderMigration,
  '062_finalize_live_semantic_promotion': finalizeLiveSemanticPromotionMigration,
  '063_skip_unconfirmed_stale_publications': skipUnconfirmedStalePublicationsMigration,
  '064_live_event_origin': liveEventOriginMigration,
  '065_live_semantic_generation_lineage': liveSemanticGenerationLineageMigration,
  '066_corporate_live_acquisition': corporateLiveAcquisitionMigration,
  '067_live_semantic_multi_claim_positions': liveSemanticMultiClaimPositionsMigration,
  '068_corporate_live_acquisition_writer': corporateLiveAcquisitionWriterMigration,
  '069_corporate_live_hash_schema_usage': corporateLiveHashSchemaUsageMigration,
  '070_corporate_live_quarantine_identity': corporateLiveQuarantineIdentityMigration,
  '071_restore_corporate_live_approval_metadata': restoreCorporateLiveApprovalMetadataMigration,
  '072_corporate_live_rights_guard_lock': corporateLiveRightsGuardLockMigration,
  '073_normalize_corporate_live_registry_keys': normalizeCorporateLiveRegistryKeysMigration,
  '074_qualify_ephemeral_article_guard_digest': qualifyEphemeralArticleGuardDigestMigration,
  '075_live_semantic_editorial_decisions': liveSemanticEditorialDecisionsMigration,
  '076_live_stance_reassessment': liveStanceReassessmentMigration,
  '077_live_semantic_event_attachment': liveSemanticEventAttachmentMigration,
  '078_editorial_focus_contrasts': editorialFocusContrastsMigration,
  '079_youtube_verified_channel_ids': youtubeVerifiedChannelIdsMigration,
  '080_user_followed_sources': userFollowedSourcesMigration,
  '081_synthesis_relation': synthesisRelationMigration,
  '082_automatic_focus_contrasts': automaticFocusContrastsMigration,
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
