import { z } from 'zod';
import { ValidationError } from '../../domain/errors/app-error.js';

/**
 * Opaque cursor for GET /v1/products keyset pagination.
 *
 * `v` is the value of the current sort's primary column at the boundary row
 * (ISO string for createdAt, number for price/soldCount/discountPercent,
 * number|null for averageRating). `id` is the tie-breaker (every sort orders
 * by `id` last, so ties on `v` never skip/duplicate rows).
 *
 * `v2` is a deliberate extension beyond a single scalar: `top_rated` orders
 * by (averageRating desc NULLS LAST, reviewCount desc, id desc) — a two
 * -column primary sort. Carrying only `averageRating` in the cursor would
 * make the keyset boundary use `id` as the tie-break for a pair of rows that
 * share the same rating but differ in reviewCount, which does not match the
 * `orderBy` — a highly-reviewed product could land a page later than it's
 * displayed order implies. `v2` (reviewCount) closes that gap. It is unused
 * for every other sort.
 */
const cursorPayloadSchema = z.object({
  v: z.union([z.string(), z.number(), z.null()]),
  v2: z.number().optional(),
  id: z.string().uuid(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductCursorValue = string | number | null;

export interface DecodedProductCursor {
  value: ProductCursorValue;
  secondaryValue: number | null;
  id: string;
  /**
   * True when `cursor` was a bare product uuid — the format used before
   * server-side sort existed, when the API only ever paginated createdAt
   * desc. Callers must resolve this against the referenced product's
   * createdAt and paginate as `newest`, regardless of the requested `sort`.
   */
  legacy: boolean;
}

export function encodeProductCursor(value: ProductCursorValue, id: string, secondaryValue?: number): string {
  const payload: { v: ProductCursorValue; id: string; v2?: number } = { v: value, id };
  if (secondaryValue !== undefined) {
    payload.v2 = secondaryValue;
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeProductCursor(raw: string): DecodedProductCursor {
  if (UUID_RE.test(raw)) {
    return { value: null, secondaryValue: null, id: raw, legacy: true };
  }

  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    const result = cursorPayloadSchema.parse(parsed);
    return { value: result.v, secondaryValue: result.v2 ?? null, id: result.id, legacy: false };
  } catch {
    throw new ValidationError('Invalid pagination cursor');
  }
}

export function expectStringCursorValue(value: ProductCursorValue): string {
  if (typeof value !== 'string') {
    throw new ValidationError('Pagination cursor does not match the requested sort');
  }
  return value;
}

export function expectNumberCursorValue(value: ProductCursorValue): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ValidationError('Pagination cursor does not match the requested sort');
  }
  return value;
}

export function expectNumberOrNullCursorValue(value: ProductCursorValue): number | null {
  if (value === null) return null;
  return expectNumberCursorValue(value);
}
