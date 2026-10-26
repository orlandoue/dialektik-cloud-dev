import { BadRequestException } from '@nestjs/common';

/**
 * The selected market is the publisher's verified operating market.
 * It is NOT proof that an occurrence happened within that territory.
 *
 * Only Chile has an attested beta source mapping. Other country codes are
 * valid selectable markets, but stay fail-closed until their source rights,
 * territorial metadata and provenance are individually accredited.
 */
export const PUBLISHER_MARKET_CODES = [
  'CL', 'PE', 'AR', 'CO', 'MX', 'ES', 'BO', 'BR', 'CR', 'CU',
  'DO', 'EC', 'GT', 'HN', 'NI', 'PA', 'PY', 'SV', 'UY', 'VE',
] as const;
export type PublisherMarket = typeof PUBLISHER_MARKET_CODES[number];

export const CHILE_PUBLISHER_DOMAINS = [
  'bcentral.cl', 'biobiochile.cl', 'sismologia.cl',
  'ciperchile.cl', 'cooperativa.cl', 'elmostrador.cl',
  'emol.com', 'gob.cl', 'latercera.com', 'senapred.gob.cl',
] as const;

export function parsePublisherMarket(value: unknown): PublisherMarket {
  if (value === undefined) return 'CL';
  if (typeof value !== 'string' ||
    !PUBLISHER_MARKET_CODES.some((code) => code === value)) {
    throw new BadRequestException('Unsupported publisher market code.');
  }
  return value as PublisherMarket;
}

export function publisherDomainsForMarket(market: PublisherMarket): readonly string[] {
  return market === 'CL' ? CHILE_PUBLISHER_DOMAINS : [];
}

export function publisherMarketsStatus() {
  return {
    scope: 'publisher_market' as const,
    default_country: 'CL' as const,
    markets: PUBLISHER_MARKET_CODES.map((code) => ({
      country_code: code,
      coverage_state: code === 'CL' ? 'BETA_AUTHORIZED_SOURCES_ONLY' : 'NOT_AVAILABLE',
    })),
  };
}
