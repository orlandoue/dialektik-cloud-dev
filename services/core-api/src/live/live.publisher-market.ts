import { BadRequestException } from '@nestjs/common';

/**
 * The selected market is the publisher's verified operating market.
 * It is NOT proof that an occurrence happened within that territory.
 *
 * Chile and two specific GOV.UK trial publishers have beta mappings. Other
 * country codes remain unavailable until their sources are accredited.
 */
export const PUBLISHER_MARKET_CODES = [
  'CL', 'PE', 'AR', 'CO', 'MX', 'ES', 'BO', 'BR', 'CR', 'CU',
  'DO', 'EC', 'GT', 'HN', 'NI', 'PA', 'PY', 'SV', 'UY', 'VE', 'UK',
] as const;
export type PublisherMarket = typeof PUBLISHER_MARKET_CODES[number];

export const CHILE_PUBLISHER_DOMAINS = [
  'bcentral.cl', 'biobiochile.cl', 'sismologia.cl',
  'ciperchile.cl', 'cooperativa.cl', 'diarioeldia.cl', 'www.diarioeldia.cl', 'elmostrador.cl', 'www.elmostrador.cl',
  'emol.com', 'gob.cl', 'latercera.com', 'senapred.gob.cl', 'senapred.cl', 'youtube.com',
] as const;

/** GOV.UK hosts many organisations; the trial includes only these two. */
export const UK_BETA_SOURCE_IDS = [
  '01M4YDQK00WS344WW8RCPCEQHE',
  '01M4YDQK00WS344WW8RCPCEQHF',
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
  if (market === 'CL') return CHILE_PUBLISHER_DOMAINS;
  if (market === 'UK') return ['gov.uk'];
  return [];
}

export function publisherMarketsStatus() {
  return {
    scope: 'publisher_market' as const,
    default_country: 'CL' as const,
    markets: PUBLISHER_MARKET_CODES.map((code) => ({
      country_code: code,
      coverage_state: code === 'CL' || code === 'UK'
        ? 'BETA_AUTHORIZED_SOURCES_ONLY'
        : 'NOT_AVAILABLE',
    })),
  };
}
