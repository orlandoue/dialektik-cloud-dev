import { Controller, Get, Inject, NotFoundException, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { LiveApplicationService } from './live.service.js';
import { LiveController } from './live.controller.js';
import { acquireGovUkRshMetadataOnce, acquireGovUkRshPreviewBatch, type GovUkRshPreviewMetadata } from './govuk-product-acquisition.js';
import { chileTornadoEditorialPreview } from './chile-tornado-evidence-preview.js';
import { acquireGovUkHousingReadOnlyPreview } from './govuk-housing-live-preview.js';
import { latestChileUsgsObservations } from './chile-usgs-seismic-observations.js';

/**
 * The beta-only GOV.UK preview is NOT a stored Article and does not change the
 * live/news contract, ingestion pipeline, rights ledger, or semantic graph.
 */
export function toGovUkReadOnlyPreview(metadata: Awaited<ReturnType<typeof acquireGovUkRshMetadataOnce>>) {
  return {
    mode: 'OFFICIAL_READ_ONLY_PREVIEW' as const,
    persisted: false as const,
    origin: 'EXTERNAL_OFFICIAL_API' as const,
    items: [{
      content_id: metadata.sourceItemId,
      headline: metadata.title,
      publisher: 'Regulator of Social Housing',
      canonical_url: metadata.canonicalUrl,
      published_at: metadata.publishedAt,
      modified_at: metadata.modifiedAt,
      attribution: metadata.attribution,
      rights_evidence_url: metadata.rightsEvidenceUrl,
    }],
  };
}

/** Ephemeral, date-descending feed of only verified original publisher metadata. */
export function toGovUkReadOnlyPreviewItems(items: readonly GovUkRshPreviewMetadata[]) {
  if (items.length < 1 || items.length > 7 ||
      new Set(items.map((item) => item.canonicalUrl)).size !== items.length) {
    throw new Error('GOVUK_PREVIEW_ITEMS_INVALID');
  }
  return {
    mode: 'OFFICIAL_READ_ONLY_PREVIEW' as const,
    persisted: false as const,
    origin: 'EXTERNAL_OFFICIAL_API' as const,
    items: items.map((item) => ({
      content_id: item.contentId,
      headline: item.title,
      publisher: item.publisher,
      canonical_url: item.canonicalUrl,
      published_at: item.publishedAt,
      modified_at: item.modifiedAt,
      attribution: item.attribution,
      rights_evidence_url: item.rightsEvidenceUrl,
    })),
  };
}

@Controller('live')
@UseGuards(PrivateBetaAuthGuard)
export class PrivateBetaLiveController extends LiveController {
  constructor(@Inject(LiveApplicationService) service: LiveApplicationService) {
    super(service);
  }

  /**
   * Authentic, public-domain USGS numerical observations for the Chile region.
   * Unrelated to journalistic /live/news and semantic contradiction publication.
   * One canonical USGS id corresponds to one observed seismic occurrence.
   * Auth required by class guard; no SQL or extra rights assertions.
   */
  @Get('observations/chile/seismic')
  async chileSeismicObservations() {
    try {
      return await latestChileUsgsObservations();
    } catch {
      throw new ServiceUnavailableException('Official seismic observations temporarily unavailable.');
    }
  }

  /**
   * Curated cross-publisher occurrence evidence for DEV UX evaluation only.
   * This is NOT a persisted Event and no automatic semantic decision occurs.
   */
  @Get('preview/events/chile-tornado')
  chileTornadoEventPreview() {
    if (process.env.DIALEKTIK_CHILE_EVENT_PREVIEW_ENABLED !== 'true') {
      throw new NotFoundException('Editorial occurrence preview disabled.');
    }
    return chileTornadoEditorialPreview();
  }

  /**
   * Bounded discovery from two verified GOV.UK issuing agencies.
   * Editorial metadata only; NOT an Event or detected contradiction.
   */
  @Get('preview/govuk/housing')
  async govUkHousingReadOnlyPreview() {
    if (process.env.DIALEKTIK_GOVUK_HOUSING_PREVIEW_ENABLED !== 'true') {
      throw new NotFoundException('Official multi-publisher preview disabled.');
    }
    try {
      return await acquireGovUkHousingReadOnlyPreview();
    } catch {
      throw new ServiceUnavailableException('Official multi-publisher preview temporarily unavailable.');
    }
  }

  /** Explicit DEV opt-in; up to seven prequalified official source items, no SQL. */
  @Get('preview/govuk')
  async govUkReadOnlyPreview() {
    if (process.env.DIALEKTIK_GOVUK_PREVIEW_ENABLED !== 'true') {
      throw new NotFoundException('Official preview disabled.');
    }
    try {
      const verified = await acquireGovUkRshPreviewBatch();
      return toGovUkReadOnlyPreviewItems(verified);
    } catch {
      // Do not leak upstream API or rights details; fail closed without an item.
      throw new ServiceUnavailableException('Official preview temporarily unavailable.');
    }
  }
}
