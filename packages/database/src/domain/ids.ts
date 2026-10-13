import { ulid } from 'ulid';

declare const ulidBrand: unique symbol;

/** A canonical, lexicographically sortable ULID. */
export type Ulid = string & { readonly [ulidBrand]: 'Ulid' };

export type RandomSource = () => number;

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isUlid(value: string): value is Ulid {
  return ULID_PATTERN.test(value);
}

export function parseUlid(value: string): Ulid {
  if (!isUlid(value)) {
    throw new TypeError('Expected a canonical uppercase ULID.');
  }
  return value;
}

/**
 * Generates an ID at an application boundary.
 *
 * Time and randomness are injectable so tests do not depend on wall-clock or
 * process-global random state.
 */
export function generateUlid(options: {
  readonly now: () => number;
  readonly random?: RandomSource;
}): Ulid {
  return parseUlid(ulid(options.now(), options.random));
}
