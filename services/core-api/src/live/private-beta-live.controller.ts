import { Controller, Get, Inject, NotFoundException, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { PrivateBetaAuthGuard } from '../private-beta/private-beta-auth.guard.js';
import { LiveApplicationService } from './live.service.js';
import { LiveController } from './live.controller.js';
import { acquireGovUkRshMetadataOnce } from './govuk-product-acquisition.js';

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

@Controller('live')
@UseGuards(PrivateBetaAuthGuard)
export class PrivateBetaLiveController extends LiveController {
  constructor(@Inject(LiveApplicationService) service: LiveApplicationService) {
    super(service);
  }

  /** Explicit DEV opt-in; exactly one prequalified official source item, no SQL. */
  @Get('preview/govuk')
  async govUkReadOnlyPreview() {
    if (process.env.DIALEKTIK_GOVUK_PREVIEW_ENABLED !== 'true') {
      throw new NotFoundException('Official preview disabled.');
    }
    try {
      const metadata = await acquireGovUkRshMetadataOnce();
      return toGovUkReadOnlyPreview(metadata);
    } catch {
      // Do not leak upstream API or rights details; fail closed without an item.
      throw new ServiceUnavailableException('Official preview temporarily unavailable.');
    }
  }
}
